// Wire-up for complex.html: takes the raw .kcm textareas verbatim, builds
// and downloads the APK. No base-layout merging, no mapping parsing.

import { buildApk, downloadBlob } from './builder.js';

const form = document.querySelector('#build-form');
const submit = form.querySelector('input[type="submit"]');
const statusEl = document.querySelector('#status');

form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;

    const prevValue = submit.value;
    submit.disabled = true;
    submit.value = 'Building...';
    statusEl.textContent = '';

    try {
        const layout = document.querySelector('#layout').value;
        const layout2El = document.querySelector('#layout2');
        const layout2 = layout2El.disabled ? null : layout2El.value;

        const apkBytes = await buildApk(layout, layout2);
        downloadBlob(apkBytes, 'ExKeyMo Keyboard Layout.apk');
    } catch (err) {
        console.error(err);
        statusEl.textContent = `Error: ${err && err.message ? err.message : err}`;
    } finally {
        submit.disabled = false;
        submit.value = prevValue;
    }
});
