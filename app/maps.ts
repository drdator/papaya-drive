import {
  forestTerrain,
  route,
  routeHeading,
  routeSamples,
  routeLength,
  distanceToRoad,
} from './terrain.ts';
import { tropicalTerrain, tropicalRoute } from './tropical-map.ts';
import { cityTerrain, cityRoute } from './city-map.ts';

export const maps = {
  ridge: {
    name: 'Ridge trail',
    hint: 'Follow the golden arches. Carry speed over the crests.',
    loading: 'Loading your car and the mountain trail.',
    terrain: forestTerrain,
    route,
    routeHeading,
    routeSamples,
    routeLength,
    distanceToRoad,
    trees: ['tree-oak', 'tree-aspen', 'tree-pine'],
    mountain: undefined,
    props: undefined,
    music: 'cozy-drive.mp3',
  },
  tropical: {
    name: 'Palm cove',
    hint: 'Follow the beach loop and drive beneath the rock arch.',
    loading: 'Loading your car, palms, and island.',
    terrain: tropicalTerrain,
    ...tropicalRoute,
    trees: ['tree-palm-tall', 'tree-palm-curved', 'tree-palm-short'],
    mountain: 'mountain-palm-cove',
    props: 'props-palm-cove',
    music: 'tropical-drive.mp3',
  },
  city: {
    name: 'Papaya city',
    hint: 'Follow the golden arches through the city blocks. Slow down for corners.',
    loading: 'Opening the shops and sweeping the streets.',
    terrain: cityTerrain,
    ...cityRoute,
    trees: [],
    mountain: undefined,
    props: 'city-papaya',
    music: 'city-night-loop.mp3',
  },
};
export type MapId = keyof typeof maps;
