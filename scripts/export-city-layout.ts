import { buildCityStreets } from './build-city-streets.ts';
import process from 'node:process';
import {
  cityAvenue,
  cityBlocks,
  cityParks,
  closedCityLinks,
  cityHeight,
} from '../app/city-layout.ts';
const min = -250,
  step = 1.25,
  count = 401;
const heights = Array.from({ length: count }, (_, j) =>
  Array.from({ length: count }, (_, i) =>
    cityHeight(min + i * step, min + j * step),
  ),
);
process.stdout.write(
  JSON.stringify({
    streets: buildCityStreets(),
    avenue: cityAvenue,
    blocks: cityBlocks,
    parks: cityParks,
    closedLinks: closedCityLinks,
    min,
    step,
    count,
    heights,
  }),
);
