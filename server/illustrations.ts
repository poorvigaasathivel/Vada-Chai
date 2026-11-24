export interface DailyIllustrationScene {
  index: number;
  id: string;
  imageUrl: string;
  sceneTheme: string;
  defaultTitle: string;
  defaultCaption: string;
  defaultQuote: string;
  defaultTip: string;
  promptSummary: string;
  fallbackPalette: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    accent: string;
    accentText: string;
    border: string;
  };
}

export const DAILY_ILLUSTRATION_SCENES: DailyIllustrationScene[] = [
  {
    index: 0,
    id: 'chai-stall-shock',
    imageUrl: '/src/assets/images/pop_chai_stall_1795531936901.jpg',
    sceneTheme: 'Roadside Chai & Receipt Shock',
    defaultTitle: 'The Twenty-Rupee Chai & The Forty-Rupee Vada Math',
    defaultCaption:
      'Every morning starts with a modest cutting chai, until the bill gently reminds you that three extra crispy vadas happened.',
    defaultQuote: '"Sir, the chai was ₹15, the extra gossip was free—the four vadas were yours!"',
    defaultTip: 'Log tiny tea-stall treats right away so small change never sneaks out unnoticed.',
    promptSummary:
      'A cheerful mustachioed chaiwala pouring masala chai in an arc behind crispy vadas while a customer stares shocked at a long receipt in bold Indian pop-art comic style.',
    fallbackPalette: {
      bg: '#FDF7E7',
      surface: '#FFFEF9',
      surfaceAlt: '#F8ECD0',
      accent: '#C4552B',
      accentText: '#FFFFFF',
      border: '#EAD7B0',
    },
  },
  {
    index: 1,
    id: 'auto-meter-bargain',
    imageUrl: '/src/assets/images/pop_auto_bargain_1795531936399.jpg',
    sceneTheme: 'Autorickshaw Fare Negotiation',
    defaultTitle: 'Meter Down vs. Heart Up',
    defaultCaption:
      'In bright street sunlight, a crisp cotton saree meets classic auto-rickshaw diplomacy while the coconut seller enjoys the theatre.',
    defaultQuote: '"Madam, traffic is heavy, petrol is shy, and my meter is feeling poetic today!"',
    defaultTip: 'Say your auto fare aloud into Voice Expense or Live Chat the moment you step out.',
    promptSummary:
      'A spirited woman in a coral-and-teal saree bargaining with a mustachioed autorickshaw driver while a coconut seller grins beside green coconuts in bold Indian pop-art comic style.',
    fallbackPalette: {
      bg: '#EFF8F9',
      surface: '#FFFFFF',
      surfaceAlt: '#DFF1F4',
      accent: '#1E6E78',
      accentText: '#FFFFFF',
      border: '#C6E2E7',
    },
  },
  {
    index: 2,
    id: 'sabzi-mandi-audit',
    imageUrl: '/src/assets/images/pop_sabzi_mandi_1795531938066.jpg',
    sceneTheme: 'Morning Sabzi Mandi Inspection',
    defaultTitle: 'The Chief Quality Auditor of Tomato Bazaar',
    defaultCaption:
      'No central bank inspects currency as carefully as a grandmother checking the ripeness of one tomato while brass scales wait patiently.',
    defaultQuote: '"Bhaiya, this tomato looks like it slept late—give me the cheerful ones with free dhaniya!"',
    defaultTip: 'Bundle your morning bazaar runs into one clean entry or live voice note at the gate.',
    promptSummary:
      'A feisty grandmother in a marigold saree squinting closely at a red tomato while a cheerful vendor holds brass weighing scales above colorful veggies and a napping dog.',
    fallbackPalette: {
      bg: '#FDF5EB',
      surface: '#FFFEFC',
      surfaceAlt: '#F8E8D4',
      accent: '#B85418',
      accentText: '#FFFFFF',
      border: '#ECD2B4',
    },
  },
  {
    index: 3,
    id: 'street-vada-pockets',
    imageUrl: '/src/assets/images/pop_street_vada_1795531938867.jpg',
    sceneTheme: 'Evening Vada Cart Temptation',
    defaultTitle: 'The Great Empty-Pocket Vada & Chaat Dilemma',
    defaultCaption:
      'Evening street lamps glow, tamarind chutney flies, and friends bravely negotiate with gravity and unexpectedly light kurta pockets.',
    defaultQuote: '"Bhaiya, make one plate extra crispy—and accept sincere friendship as UPI?"',
    defaultTip: 'Keeping a watchful eye on your 10% balance cushion saves evening snack plans.',
    promptSummary:
      'Two friends in colorful kurtas turning empty pockets inside out with grins beside a vibrant street cart heaped with vadas and pani puri in bold Indian pop-art comic style.',
    fallbackPalette: {
      bg: '#F4F1FA',
      surface: '#FDFCFE',
      surfaceAlt: '#E7E0F5',
      accent: '#63439C',
      accentText: '#FFFFFF',
      border: '#D6CBEB',
    },
  },
  {
    index: 4,
    id: 'monsoon-vada-rescue',
    imageUrl: '/src/assets/images/pop_monsoon_pakora_1795531939801.jpg',
    sceneTheme: 'Monsoon Vada Priority',
    defaultTitle: 'Umbrellas Up, Hot Vadas Protected',
    defaultCaption:
      'In a sudden downpour, shoes are negotiable and trousers can dry, but a warm plate of crispy vadas requires Olympic-level shielding.',
    defaultQuote: '"Save the vadas first, brother—I have another pair of chappals at home!"',
    defaultTip: 'Rainy-day snacks add up fast; track them before your wallet catches a chill.',
    promptSummary:
      'Commuters under polka-dot umbrellas on a rainy street while a man leaps to shield hot vadas from a passing yellow-and-black taxi splash in bold Indian pop-art comic style.',
    fallbackPalette: {
      bg: '#EEF7FA',
      surface: '#FCFDFE',
      surfaceAlt: '#DCEEF4',
      accent: '#1F6380',
      accentText: '#FFFFFF',
      border: '#C5E0EA',
    },
  },
];

export function getDateKey(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getSceneIndexForDateKey(dateKey: string): number {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return hash % DAILY_ILLUSTRATION_SCENES.length;
}
