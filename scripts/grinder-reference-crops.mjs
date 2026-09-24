import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';

const source = 'C:/Users/30949/Desktop/参考图/打磨.png';
const image = PNG.sync.read(await readFile(source));
const directory = 'artifacts/grinder-reference';
await mkdir(directory, { recursive: true });
const crops = {
  hero: [8, 14, 518, 870],
  front: [590, 109, 165, 367],
  side: [773, 117, 250, 365],
  rear: [1073, 112, 136, 365],
  abrasive: [331, 125, 37, 220],
  iron: [194, 336, 33, 167],
  steel: [327, 436, 98, 20],
};
for (const [name, [x, y, width, height]] of Object.entries(crops)) {
  const crop = new PNG({ width, height });
  PNG.bitblt(image, crop, x, y, width, height, 0, 0);
  await writeFile(`${directory}/${name}.png`, PNG.sync.write(crop));
}
await writeFile(`${directory}/provenance.json`, JSON.stringify({ source, width: image.width, height: image.height, crops }, null, 2));
