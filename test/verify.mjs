// End-to-end test: build a signed APK using only the browser-compatible
// modules, then use external tools (openssl) to verify the signature and
// the internal SHA-1 digests match the manifest/SF claims.
//
// Run with: node test/verify.mjs

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzip, zip } from '../js/zip.js';
import { signV1 } from '../js/signer.js';
import { fromLayout } from '../js/layouts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'test', '.tmp');

async function main() {
    await rm(TMP, { recursive: true, force: true });
    await mkdir(TMP, { recursive: true });

    const cert = await readFile(path.join(ROOT, 'assets/cert.pem'), 'utf8');
    const key = await readFile(path.join(ROOT, 'assets/key.pem'), 'utf8');

    for (const variant of ['one', 'two']) {
        console.log(`\n=== variant: ${variant} layout ===`);
        const templateFile = variant === 'one'
            ? 'app-oneLayout-release-unsigned.apk'
            : 'app-twoLayouts-release-unsigned.apk';
        const templateBytes = new Uint8Array(await readFile(path.join(ROOT, 'assets', templateFile)));

        const entries = await unzip(templateBytes);

        // Sample layout content matching simple.html "swap Caps and Esc".
        const sample = fromLayout(null, new Map([['58', 'ESCAPE'], ['1', 'CAPS_LOCK']]));
        const enc = new TextEncoder();
        const patched = [];
        for (const e of entries) {
            if (e.name === 'res/Q2.kcm') patched.push({ name: e.name, data: enc.encode(sample) });
            else if (variant === 'two' && e.name === 'res/_f.kcm') patched.push({ name: e.name, data: enc.encode(sample) });
            else patched.push(e);
        }

        const sigEntries = await signV1(patched, cert, key);
        const all = [...sigEntries, ...patched];
        const apk = await zip(all);

        const outApk = path.join(TMP, `test-${variant}.apk`);
        await writeFile(outApk, apk);
        console.log(`wrote ${outApk} (${apk.length} bytes)`);

        // Round-trip read to sanity-check the ZIP.
        const rtEntries = await unzip(new Uint8Array(await readFile(outApk)));
        const names = rtEntries.map(e => e.name);
        console.log('entries:', names.join(', '));

        const manifest = rtEntries.find(e => e.name === 'META-INF/MANIFEST.MF');
        const sf = rtEntries.find(e => e.name === 'META-INF/INTERMED.SF');
        const rsa = rtEntries.find(e => e.name === 'META-INF/INTERMED.RSA');
        if (!manifest || !sf || !rsa) throw new Error('missing signature files');

        // Check per-file SHA-1 claims in MANIFEST.MF match actual entry bytes.
        const manifestText = new TextDecoder().decode(manifest.data);
        const fileClaims = parseManifestDigests(manifestText);
        let mismatches = 0;
        for (const e of rtEntries) {
            if (e.name.startsWith('META-INF/')) continue;
            const claimed = fileClaims.get(e.name);
            if (!claimed) { console.error(`NO CLAIM for ${e.name}`); mismatches++; continue; }
            const actual = createHash('sha1').update(e.data).digest('base64');
            if (actual !== claimed) {
                console.error(`BAD digest for ${e.name}: claimed=${claimed} actual=${actual}`);
                mismatches++;
            }
        }
        if (mismatches > 0) throw new Error(`${mismatches} manifest digest mismatch(es)`);
        console.log('manifest digests: OK');

        // Check SF digests:
        //  SHA1-Digest-Manifest               = SHA1 over full manifest bytes
        //  SHA1-Digest-Manifest-Main-Attributes = SHA1 over main-only
        //  per-file SHA1-Digest                = SHA1 over that entry's section bytes
        const sfText = new TextDecoder().decode(sf.data);
        const sfMain = parseMainSection(sfText);
        const mfSha = createHash('sha1').update(manifest.data).digest('base64');
        if (sfMain['SHA1-Digest-Manifest'] !== mfSha) {
            throw new Error(`SHA1-Digest-Manifest mismatch: sf=${sfMain['SHA1-Digest-Manifest']} actual=${mfSha}`);
        }
        const mainOnly = extractMainSection(manifest.data);
        const mainSha = createHash('sha1').update(mainOnly).digest('base64');
        if (sfMain['SHA1-Digest-Manifest-Main-Attributes'] !== mainSha) {
            throw new Error(`SHA1-Digest-Manifest-Main-Attributes mismatch: sf=${sfMain['SHA1-Digest-Manifest-Main-Attributes']} actual=${mainSha}`);
        }
        console.log('SF main-section claims: OK');

        const sfFileClaims = parseManifestDigests(sfText);
        for (const [entryName, claimedDigest] of sfFileClaims) {
            const sectionBytes = extractEntrySection(manifest.data, entryName);
            const actual = createHash('sha1').update(sectionBytes).digest('base64');
            if (actual !== claimedDigest) {
                throw new Error(`SF per-file digest mismatch for ${entryName}: claimed=${claimedDigest} actual=${actual}`);
            }
        }
        console.log('SF per-file section claims: OK');

        // Use openssl cms to verify the RSA file actually signs the SF bytes.
        const rsaPath = path.join(TMP, `${variant}.rsa`);
        const sfPath = path.join(TMP, `${variant}.sf`);
        const certPath = path.join(ROOT, 'assets/cert.pem');
        await writeFile(rsaPath, rsa.data);
        await writeFile(sfPath, sf.data);
        const res = spawnSync('openssl', [
            'cms', '-verify', '-inform', 'DER',
            '-in', rsaPath,
            '-content', sfPath,
            '-certfile', certPath,
            '-CAfile', certPath,
            '-no_check_time',
            '-out', '/dev/null',
        ], { encoding: 'utf8' });
        if (res.status !== 0) {
            console.error('openssl stderr:', res.stderr);
            throw new Error(`openssl cms -verify failed (status ${res.status})`);
        }
        console.log('openssl cms -verify: OK (', res.stderr.trim(), ')');
    }

    console.log('\nall checks passed');
}

// ---- manifest parsing helpers -------------------------------------------
function parseManifestDigests(text) {
    // Unfold continuation lines (lines starting with ' ') and extract
    // per-entry (Name, SHA1-Digest) pairs.
    const map = new Map();
    const sections = text.split(/\r\n\r\n/);
    for (const sec of sections) {
        if (!sec.trim()) continue;
        const attrs = parseAttrs(sec);
        if (!attrs.Name) continue;
        if (!attrs['SHA1-Digest']) continue;
        map.set(attrs.Name, attrs['SHA1-Digest']);
    }
    return map;
}

function parseMainSection(text) {
    const sections = text.split(/\r\n\r\n/);
    return parseAttrs(sections[0] || '');
}

function parseAttrs(section) {
    const unfolded = section.replace(/\r\n /g, '');
    const out = {};
    for (const line of unfolded.split(/\r\n/)) {
        const idx = line.indexOf(': ');
        if (idx < 0) continue;
        out[line.substring(0, idx)] = line.substring(idx + 2);
    }
    return out;
}

function extractMainSection(buf) {
    // The main section ends at the first "\r\n\r\n".
    const s = new TextDecoder().decode(buf);
    const idx = s.indexOf('\r\n\r\n');
    if (idx < 0) throw new Error('main section terminator not found');
    return new TextEncoder().encode(s.substring(0, idx + 4));
}

function extractEntrySection(buf, name) {
    // Walk sections, looking for "Name: <name>" (allowing continuation lines).
    const s = new TextDecoder().decode(buf);
    const sections = s.split(/\r\n\r\n/);
    for (const sec of sections) {
        if (!sec.trim()) continue;
        const unfolded = sec.replace(/\r\n /g, '');
        const m = unfolded.match(/^Name: (.+)$/m);
        if (!m) continue;
        if (m[1] !== name) continue;
        return new TextEncoder().encode(sec + '\r\n\r\n');
    }
    throw new Error(`section for ${name} not found`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
