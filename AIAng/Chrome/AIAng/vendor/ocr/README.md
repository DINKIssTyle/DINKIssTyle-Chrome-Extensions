# Local OCR assets

Tesseract.js 7.0.0 and tesseract.js-core 7.0.0 (Apache-2.0), with Korean and English best_int data from @tesseract.js-data/kor 1.0.0 and @tesseract.js-data/eng 1.0.0 (npm packages declare MIT; upstream Tesseract trained data is Apache-2.0).
Sources: https://github.com/naptha/tesseract.js, https://github.com/naptha/tesseract.js-core, https://github.com/naptha/tessdata.
These assets are bundled to keep screenshots and OCR processing on the device; no remote executable code is loaded.
Portable LSTM WASM core includes its binary in the .wasm.js file.

The upstream trained-data license is Apache-2.0: https://github.com/naptha/tessdata/blob/gh-pages/LICENSE (the included tesseract.js-LICENSE.md contains the Apache-2.0 license text).
