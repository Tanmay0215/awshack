import type { Impact } from './api';

export type Guide = {
  bin: string;
  binColor: string;
  steps: string[];
  mistake: string;
  becomes: string;
};

// Bin colours follow the common wet (green) / dry (blue) split; local rules vary by city.
const WET = { bin: 'Wet waste / organics', binColor: '#2f8f3a' };
const DRY = { bin: 'Dry waste / recyclables', binColor: '#1f5fa8' };

export const GUIDE: Record<string, Guide> = {
  BIODEGRADABLE: {
    ...WET,
    steps: ['Remove any plastic wrap, stickers or rubber bands', 'Drain liquids before binning', 'Compost at home if you can'],
    mistake: '"Biodegradable" plastic bags do not break down in normal compost. Keep them out.',
    becomes: 'Compost or biogas instead of landfill methane',
  },
  CARDBOARD: {
    ...DRY,
    steps: ['Flatten boxes to save space', 'Remove tape and plastic inserts', 'Keep it dry'],
    mistake: 'Greasy or food-soaked cardboard (pizza boxes) goes to wet waste, not recycling.',
    becomes: 'New boxes and paperboard, often within weeks',
  },
  GLASS: {
    ...DRY,
    steps: ['Rinse out food and drink', 'Remove lids and caps (recycle metal caps separately)', 'Do not break it on purpose'],
    mistake: 'Window glass, mirrors, ceramics and light bulbs are not bottle glass. Keep them out.',
    becomes: 'New bottles and jars; glass recycles endlessly without losing quality',
  },
  METAL: {
    ...DRY,
    steps: ['Rinse cans', 'Crush them if your area allows it', 'Put loose foil together in a ball'],
    mistake: 'Aerosol cans that are not empty, and batteries, are hazardous. Take them to a drop-off point.',
    becomes: 'New cans and metal parts; recycled aluminium uses ~95% less energy than new',
  },
  PAPER: {
    ...DRY,
    steps: ['Keep it clean and dry', 'Remove plastic windows and binding if easy', 'Do not shred unless needed (short fibres are harder to recycle)'],
    mistake: 'Tissues, napkins and paper cups with plastic lining are not recyclable paper.',
    becomes: 'Recycled paper, newsprint and egg cartons',
  },
  PLASTIC: {
    ...DRY,
    steps: ['Empty and rinse', 'Put caps back on bottles', 'Squash bottles to save space'],
    mistake: 'Dirty food containers and plastic bags jam sorting machines. Clean them, or return bags to store drop-offs.',
    becomes: 'Fibre for clothing, new bottles, outdoor furniture',
  },
};

export const guideOf = (c: string): Guide | undefined => GUIDE[c.toUpperCase()];

export const fmtKg = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(kg < 10 ? 2 : 1)} kg`);

/** One-line plain-language equivalent for a CO2e figure. */
export function equivalent(i: Pick<Impact, 'car_km' | 'tree_days'>): string {
  if (i.car_km >= 1) return `like not driving a car ${i.car_km.toFixed(i.car_km < 10 ? 1 : 0)} km`;
  return `what a tree absorbs in ${i.tree_days.toFixed(1)} days`;
}
