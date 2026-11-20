/**
 * The periodic table: atomic number, symbol, name, atomic weight, category
 * and position (group 1–18, period 1–7; group 0 = the f-block rows).
 *
 * Atomic weights are the IUPAC CIAAW standard atomic weights ("Atomic
 * Weights 2021", with the 2024 revisions for Gd, Lu and Zr). Elements whose
 * standard weight is an interval use CIAAW's conventional value (H 1.008,
 * C 12.011, Cl 35.45 ...). Elements with no stable isotopes have no standard
 * atomic weight; for those `radioactive` is true and `weight` is the mass
 * number of the longest-lived known isotope, shown in brackets.
 */

export type ElementCategory =
  | "alkali"
  | "alkaline-earth"
  | "transition"
  | "lanthanide"
  | "actinide"
  | "post-transition"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas";

export type ChemicalElement = {
  z: number;
  symbol: string;
  name: string;
  weight: number;
  category: ElementCategory;
  /** 1–18, or 0 for lanthanides and actinides (shown in their own rows). */
  group: number;
  period: number;
  radioactive: boolean;
};

type Row = [number, string, string, number, ElementCategory, number, number, boolean];

// prettier-ignore
const ROWS: Row[] = [
  [1, "H", "Hydrogen", 1.008, "nonmetal", 1, 1, false],
  [2, "He", "Helium", 4.002602, "noble-gas", 18, 1, false],
  [3, "Li", "Lithium", 6.94, "alkali", 1, 2, false],
  [4, "Be", "Beryllium", 9.0121831, "alkaline-earth", 2, 2, false],
  [5, "B", "Boron", 10.81, "metalloid", 13, 2, false],
  [6, "C", "Carbon", 12.011, "nonmetal", 14, 2, false],
  [7, "N", "Nitrogen", 14.007, "nonmetal", 15, 2, false],
  [8, "O", "Oxygen", 15.999, "nonmetal", 16, 2, false],
  [9, "F", "Fluorine", 18.998403162, "halogen", 17, 2, false],
  [10, "Ne", "Neon", 20.1797, "noble-gas", 18, 2, false],
  [11, "Na", "Sodium", 22.98976928, "alkali", 1, 3, false],
  [12, "Mg", "Magnesium", 24.305, "alkaline-earth", 2, 3, false],
  [13, "Al", "Aluminum", 26.9815384, "post-transition", 13, 3, false],
  [14, "Si", "Silicon", 28.085, "metalloid", 14, 3, false],
  [15, "P", "Phosphorus", 30.973761998, "nonmetal", 15, 3, false],
  [16, "S", "Sulfur", 32.06, "nonmetal", 16, 3, false],
  [17, "Cl", "Chlorine", 35.45, "halogen", 17, 3, false],
  [18, "Ar", "Argon", 39.95, "noble-gas", 18, 3, false],
  [19, "K", "Potassium", 39.0983, "alkali", 1, 4, false],
  [20, "Ca", "Calcium", 40.078, "alkaline-earth", 2, 4, false],
  [21, "Sc", "Scandium", 44.955907, "transition", 3, 4, false],
  [22, "Ti", "Titanium", 47.867, "transition", 4, 4, false],
  [23, "V", "Vanadium", 50.9415, "transition", 5, 4, false],
  [24, "Cr", "Chromium", 51.9961, "transition", 6, 4, false],
  [25, "Mn", "Manganese", 54.938043, "transition", 7, 4, false],
  [26, "Fe", "Iron", 55.845, "transition", 8, 4, false],
  [27, "Co", "Cobalt", 58.933194, "transition", 9, 4, false],
  [28, "Ni", "Nickel", 58.6934, "transition", 10, 4, false],
  [29, "Cu", "Copper", 63.546, "transition", 11, 4, false],
  [30, "Zn", "Zinc", 65.38, "transition", 12, 4, false],
  [31, "Ga", "Gallium", 69.723, "post-transition", 13, 4, false],
  [32, "Ge", "Germanium", 72.63, "metalloid", 14, 4, false],
  [33, "As", "Arsenic", 74.921595, "metalloid", 15, 4, false],
  [34, "Se", "Selenium", 78.971, "nonmetal", 16, 4, false],
  [35, "Br", "Bromine", 79.904, "halogen", 17, 4, false],
  [36, "Kr", "Krypton", 83.798, "noble-gas", 18, 4, false],
  [37, "Rb", "Rubidium", 85.4678, "alkali", 1, 5, false],
  [38, "Sr", "Strontium", 87.62, "alkaline-earth", 2, 5, false],
  [39, "Y", "Yttrium", 88.905838, "transition", 3, 5, false],
  [40, "Zr", "Zirconium", 91.222, "transition", 4, 5, false],
  [41, "Nb", "Niobium", 92.90637, "transition", 5, 5, false],
  [42, "Mo", "Molybdenum", 95.95, "transition", 6, 5, false],
  [43, "Tc", "Technetium", 98, "transition", 7, 5, true],
  [44, "Ru", "Ruthenium", 101.07, "transition", 8, 5, false],
  [45, "Rh", "Rhodium", 102.90549, "transition", 9, 5, false],
  [46, "Pd", "Palladium", 106.42, "transition", 10, 5, false],
  [47, "Ag", "Silver", 107.8682, "transition", 11, 5, false],
  [48, "Cd", "Cadmium", 112.414, "transition", 12, 5, false],
  [49, "In", "Indium", 114.818, "post-transition", 13, 5, false],
  [50, "Sn", "Tin", 118.71, "post-transition", 14, 5, false],
  [51, "Sb", "Antimony", 121.76, "metalloid", 15, 5, false],
  [52, "Te", "Tellurium", 127.6, "metalloid", 16, 5, false],
  [53, "I", "Iodine", 126.90447, "halogen", 17, 5, false],
  [54, "Xe", "Xenon", 131.293, "noble-gas", 18, 5, false],
  [55, "Cs", "Cesium", 132.90545196, "alkali", 1, 6, false],
  [56, "Ba", "Barium", 137.327, "alkaline-earth", 2, 6, false],
  [57, "La", "Lanthanum", 138.90547, "lanthanide", 0, 6, false],
  [58, "Ce", "Cerium", 140.116, "lanthanide", 0, 6, false],
  [59, "Pr", "Praseodymium", 140.90766, "lanthanide", 0, 6, false],
  [60, "Nd", "Neodymium", 144.242, "lanthanide", 0, 6, false],
  [61, "Pm", "Promethium", 145, "lanthanide", 0, 6, true],
  [62, "Sm", "Samarium", 150.36, "lanthanide", 0, 6, false],
  [63, "Eu", "Europium", 151.964, "lanthanide", 0, 6, false],
  [64, "Gd", "Gadolinium", 157.249, "lanthanide", 0, 6, false],
  [65, "Tb", "Terbium", 158.925354, "lanthanide", 0, 6, false],
  [66, "Dy", "Dysprosium", 162.5, "lanthanide", 0, 6, false],
  [67, "Ho", "Holmium", 164.930329, "lanthanide", 0, 6, false],
  [68, "Er", "Erbium", 167.259, "lanthanide", 0, 6, false],
  [69, "Tm", "Thulium", 168.934219, "lanthanide", 0, 6, false],
  [70, "Yb", "Ytterbium", 173.045, "lanthanide", 0, 6, false],
  [71, "Lu", "Lutetium", 174.96669, "lanthanide", 0, 6, false],
  [72, "Hf", "Hafnium", 178.486, "transition", 4, 6, false],
  [73, "Ta", "Tantalum", 180.94788, "transition", 5, 6, false],
  [74, "W", "Tungsten", 183.84, "transition", 6, 6, false],
  [75, "Re", "Rhenium", 186.207, "transition", 7, 6, false],
  [76, "Os", "Osmium", 190.23, "transition", 8, 6, false],
  [77, "Ir", "Iridium", 192.217, "transition", 9, 6, false],
  [78, "Pt", "Platinum", 195.084, "transition", 10, 6, false],
  [79, "Au", "Gold", 196.96657, "transition", 11, 6, false],
  [80, "Hg", "Mercury", 200.592, "transition", 12, 6, false],
  [81, "Tl", "Thallium", 204.38, "post-transition", 13, 6, false],
  [82, "Pb", "Lead", 207.2, "post-transition", 14, 6, false],
  [83, "Bi", "Bismuth", 208.9804, "post-transition", 15, 6, false],
  [84, "Po", "Polonium", 209, "post-transition", 16, 6, true],
  [85, "At", "Astatine", 210, "halogen", 17, 6, true],
  [86, "Rn", "Radon", 222, "noble-gas", 18, 6, true],
  [87, "Fr", "Francium", 223, "alkali", 1, 7, true],
  [88, "Ra", "Radium", 226, "alkaline-earth", 2, 7, true],
  [89, "Ac", "Actinium", 227, "actinide", 0, 7, true],
  [90, "Th", "Thorium", 232.0377, "actinide", 0, 7, false],
  [91, "Pa", "Protactinium", 231.03588, "actinide", 0, 7, false],
  [92, "U", "Uranium", 238.02891, "actinide", 0, 7, false],
  [93, "Np", "Neptunium", 237, "actinide", 0, 7, true],
  [94, "Pu", "Plutonium", 244, "actinide", 0, 7, true],
  [95, "Am", "Americium", 243, "actinide", 0, 7, true],
  [96, "Cm", "Curium", 247, "actinide", 0, 7, true],
  [97, "Bk", "Berkelium", 247, "actinide", 0, 7, true],
  [98, "Cf", "Californium", 251, "actinide", 0, 7, true],
  [99, "Es", "Einsteinium", 252, "actinide", 0, 7, true],
  [100, "Fm", "Fermium", 257, "actinide", 0, 7, true],
  [101, "Md", "Mendelevium", 258, "actinide", 0, 7, true],
  [102, "No", "Nobelium", 259, "actinide", 0, 7, true],
  [103, "Lr", "Lawrencium", 266, "actinide", 0, 7, true],
  [104, "Rf", "Rutherfordium", 267, "transition", 4, 7, true],
  [105, "Db", "Dubnium", 268, "transition", 5, 7, true],
  [106, "Sg", "Seaborgium", 269, "transition", 6, 7, true],
  [107, "Bh", "Bohrium", 270, "transition", 7, 7, true],
  [108, "Hs", "Hassium", 269, "transition", 8, 7, true],
  [109, "Mt", "Meitnerium", 278, "transition", 9, 7, true],
  [110, "Ds", "Darmstadtium", 281, "transition", 10, 7, true],
  [111, "Rg", "Roentgenium", 282, "transition", 11, 7, true],
  [112, "Cn", "Copernicium", 285, "transition", 12, 7, true],
  [113, "Nh", "Nihonium", 286, "post-transition", 13, 7, true],
  [114, "Fl", "Flerovium", 289, "post-transition", 14, 7, true],
  [115, "Mc", "Moscovium", 290, "post-transition", 15, 7, true],
  [116, "Lv", "Livermorium", 293, "post-transition", 16, 7, true],
  [117, "Ts", "Tennessine", 294, "halogen", 17, 7, true],
  [118, "Og", "Oganesson", 294, "noble-gas", 18, 7, true],
];

export const ELEMENTS: readonly ChemicalElement[] = ROWS.map(
  ([z, symbol, name, weight, category, group, period, radioactive]) => ({
    z,
    symbol,
    name,
    weight,
    category,
    group,
    period,
    radioactive,
  }),
);

export const ELEMENT_BY_SYMBOL: ReadonlyMap<string, ChemicalElement> = new Map(
  ELEMENTS.map((e) => [e.symbol, e]),
);

export const CATEGORY_LABELS: Record<ElementCategory, string> = {
  alkali: "Alkali metal",
  "alkaline-earth": "Alkaline earth metal",
  transition: "Transition metal",
  lanthanide: "Lanthanide",
  actinide: "Actinide",
  "post-transition": "Post-transition metal",
  metalloid: "Metalloid",
  nonmetal: "Nonmetal",
  halogen: "Halogen",
  "noble-gas": "Noble gas",
};

/** "1.008", "22.99", "[98]": short form for tiles and tables. */
export function formatWeight(el: ChemicalElement, decimals = 3): string {
  if (el.radioactive) return `[${el.weight}]`;
  return String(Number(el.weight.toFixed(decimals)));
}
