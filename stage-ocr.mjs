import { copyFile, mkdir } from 'node:fs/promises';

const output=new URL('./public/ocr/',import.meta.url);
await mkdir(output,{recursive:true});
const files={
  'tesseract.min.js':'tesseract.js/dist/tesseract.min.js',
  'worker.min.js':'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js':'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js':'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'chi_sim.traineddata.gz':'@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz',
  'eng.traineddata.gz':'@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'LICENSE-tesseract.txt':'tesseract.js/LICENSE.md',
  'LICENSE-core.txt':'tesseract.js-core/LICENSE',
};
await Promise.all(Object.entries(files).map(([name,source])=>
  copyFile(new URL('./node_modules/'+source,import.meta.url),new URL(name,output))));
