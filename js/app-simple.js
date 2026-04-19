// Wire-up for simple.html: collects from/to pairs + optional base layouts,
// builds .kcm content via layouts.js, then builds and downloads the APK.

import { fromLayout } from './layouts.js';
import { buildApk, collectSimpleMappings, loadBaseKcm, downloadBlob } from './builder.js';

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
        const data = new FormData(form);
        const mappings = collectSimpleMappings(data);

        const layoutName = data.get('layout') || '';
        const layout2Name = data.get('layout2');
        const hasSecondLayout = layout2Name !== null && layout2Name !== '-';

        const [baseLayout, baseLayout2] = await Promise.all([
            loadBaseKcm(layoutName),
            hasSecondLayout ? loadBaseKcm(layout2Name) : Promise.resolve(null),
        ]);

        const layout = fromLayout(baseLayout, mappings);
        const layout2 = hasSecondLayout ? fromLayout(baseLayout2, mappings) : null;

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
