// Starting lists for a new project. Everything here can be changed in Settings.

// The room type decides where a room appears on the dashboard house (Stage 2).
export const ROOM_TYPES = [
  { id: 'kitchen', label: 'Kitchen', emoji: '🍳' },
  { id: 'bathroom', label: 'Bathroom', emoji: '🛁' },
  { id: 'bedroom', label: 'Bedroom', emoji: '🛏️' },
  { id: 'living', label: 'Living', emoji: '🛋️' },
  { id: 'laundry', label: 'Laundry', emoji: '🧺' },
  { id: 'outdoor', label: 'Deck / outdoor', emoji: '🌿' },
  { id: 'garage', label: 'Garage', emoji: '🚗' },
  { id: 'exterior', label: 'Roof / exterior', emoji: '🏠' },
  { id: 'whole', label: 'Whole house / stage', emoji: '🎨' },
  { id: 'other', label: 'Other', emoji: '📦' },
];

export function roomType(id) {
  return ROOM_TYPES.find((t) => t.id === id) || ROOM_TYPES[ROOM_TYPES.length - 1];
}

export const SUGGESTED_ROOMS = [
  { name: 'Kitchen', type: 'kitchen' },
  { name: 'Bathroom', type: 'bathroom' },
  { name: 'Deck', type: 'outdoor' },
  { name: 'Painting', type: 'whole' },
  { name: 'General / whole house', type: 'whole' },
];

export const DEFAULT_CATEGORIES = [
  { name: 'Tools', isTool: true },
  { name: 'Hardware & fixings' },
  { name: 'Materials' },
  { name: 'Paint & finishes' },
  { name: 'Fixtures & fittings' },
  { name: 'Equipment hire' },
  { name: 'Waste / disposal' },
  { name: 'Trades / labour' },
  { name: 'Other' },
];

// defaultCategory is matched by name when the project is created.
export const DEFAULT_STORES = [
  { name: 'Bunnings' },
  { name: 'Mitre 10' },
  { name: 'Total Tools', defaultCategory: 'Tools' },
];
