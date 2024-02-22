
// units -----------------------------------------------------------------------------------------


// 255 bytes for base units
export enum Unit {

	// SI base units 0x00 - 0x0f
	SECOND  = 0x00,
	METRE   = 0x01,
	GRAM    = 0x02,
	AMPERE  = 0x03,
	KELVIN  = 0x04,
	MOLE    = 0x05,
	CANDELA = 0x06,

	// Currency units with ISO codes 0xa0 - 0xdf
	EUR    = 0xa0,
	USD    = 0xa1,
	GBP    = 0xa2,
	RUB    = 0xa3,
	CNY    = 0xa4,
	JPY    = 0xa5,

	CMO    = 0xc0, // calendar month

	UNYT   = 0xd0,

	DIMENSIONLESS = 0xff,

}


export const UnitSymbol = {

	[Unit.SECOND]: 's',
	[Unit.METRE]: 'm',
	[Unit.GRAM]: 'g',
	[Unit.AMPERE]: 'A',
	[Unit.KELVIN]: 'K',
	[Unit.MOLE]: 'mol',
	[Unit.CANDELA]: 'cd',

	[Unit.EUR]: 'EUR',
	[Unit.USD]: 'USD',
	[Unit.GBP]: 'GBP',
	[Unit.RUB]: 'RUB',
	[Unit.CNY]: 'CNY',
	[Unit.JPY]: 'JPY',

	[Unit.UNYT]: 'UNYT',

	[Unit.DIMENSIONLESS]: 'x',

	[Unit.CMO]: 'Cmo',


} as const;

export const UnitCodeBySymbol =  {

	's': 	Unit.SECOND,
	'm': 	Unit.METRE,
	'g': 	Unit.GRAM,
	'A': 	Unit.AMPERE,
	'K': 	Unit.KELVIN,
	'mol': 	Unit.MOLE,
	'cd':	Unit.CANDELA,

	'EUR': 	Unit.EUR,
	'USD': 	Unit.USD,
	'GBP': 	Unit.GBP,
	'RUB': 	Unit.RUB,
	'CNY': 	Unit.CNY,
	'JPY': 	Unit.JPY,

	'UNYT': 	Unit.UNYT,

	'x': 	Unit.DIMENSIONLESS,
	'1': 	Unit.DIMENSIONLESS,

	'Cmo': Unit.CMO

} as const;


export const UnitCodeBySymbolShortForms =  {
	'€': 	Unit.EUR,
	'$': 	Unit.USD,
	'£':    Unit.GBP,
	'₽':    Unit.RUB,
	'¥':    Unit.CNY,
} as const;

export const UnitSymbolShortFormsByCode =  {
	[Unit.EUR]: '€',
	[Unit.USD]: '$',
	[Unit.GBP]: '£',
	[Unit.RUB]: '₽',
	[Unit.CNY]: '¥',
} as const;


// complex units derived from SI units
const ONE_KG                  =	[1000, 1, Unit.GRAM];
const ONE_PER_KG              = [1000, 1, Unit.GRAM, -1];
const ONE_SQUARE_METRE        = [1, 1, Unit.METRE, 2];
const ONE_PER_SQUARE_METRE    = [1, 1, Unit.METRE, -2];
const ONE_PER_SECOND          = [1, 1, Unit.SECOND, -1];
const ONE_PER_SQUARE_SECOND   = [1, 1, Unit.SECOND, -2];
const ONE_PER_CUBE_SECOND     = [1, 1, Unit.SECOND, -3];

const JOULE                   = [ONE_KG, ONE_SQUARE_METRE, ONE_PER_SQUARE_SECOND]

export const DerivedUnits = {

	// [numerator, denominator, base unit][]

	'rad':  [[1, 1, Unit.DIMENSIONLESS]],
	'sr':   [[1, 1, Unit.DIMENSIONLESS]],

	'N':    [ONE_KG, [1, 1, Unit.METRE], ONE_PER_SQUARE_SECOND],
	'Hz':   [ONE_PER_SECOND],
	'Pa':   [ONE_KG, [1, 1, Unit.METRE, -1], ONE_PER_SQUARE_SECOND],
	'J':    JOULE,
	'W':    [ONE_KG, ONE_SQUARE_METRE, ONE_PER_CUBE_SECOND],
	'C':    [[1, 1, Unit.SECOND], [1, 1, Unit.AMPERE]],
	'V':    [ONE_KG, ONE_SQUARE_METRE, ONE_PER_CUBE_SECOND, [1, 1, Unit.AMPERE, -1]],
	'F':    [ONE_PER_KG, ONE_PER_SQUARE_METRE, [1, 1, Unit.SECOND, 4], [1, 1, Unit.AMPERE, 2]],

	// Ohm - two versions
	'O':    [ONE_KG, ONE_SQUARE_METRE, ONE_PER_CUBE_SECOND, [1, 1, Unit.AMPERE, -2]],
	'Ω':    [ONE_KG, ONE_SQUARE_METRE, ONE_PER_CUBE_SECOND, [1, 1, Unit.AMPERE, -2]],

	'S':    [ONE_PER_KG, ONE_PER_SQUARE_METRE, [1, 1, Unit.SECOND, 3], [1, 1, Unit.AMPERE, 2]],
	'Wb':   [ONE_KG, ONE_SQUARE_METRE, ONE_PER_SQUARE_SECOND, [1, 1, Unit.AMPERE, -1]],
	'T':    [ONE_KG, ONE_PER_SQUARE_SECOND, [1, 1, Unit.AMPERE, -1]],
	'H':    [ONE_KG, ONE_SQUARE_METRE, ONE_PER_SQUARE_SECOND, [1, 1, Unit.AMPERE, -2]],
	// TODO °C?
	'lm':   [[1, 1, Unit.CANDELA]],
	'lx':   [[1, 1, Unit.CANDELA], ONE_PER_SQUARE_METRE],
	'Bq':   [ONE_PER_SECOND],
	'Gy':   [ONE_SQUARE_METRE, ONE_PER_SQUARE_SECOND],
	'kat':  [[1, 1, Unit.MOLE], ONE_PER_SECOND],

	// Non-SI
	'l'  :  [[1, 1000, Unit.METRE, 3]],
	'eV':   [[1, 160_217_700_000_000_000, Unit.DIMENSIONLESS], ...JOULE], // electron volt


} as const;


// aliases with a simple prefactor
export const UnitAliases = {

	// [numerator, denominator, base unit]

	'min': [60, 		1, Unit.SECOND],
	'h':   [60*60, 		1, Unit.SECOND],
	'd':   [60*60*24, 	1, Unit.SECOND],
	'a':   [31_557_600, 1, Unit.SECOND], // year definition (Julian calendar) from https://www.iau.org/publications/proceedings_rules/units/
	'yr':   [31_557_600, 1, Unit.SECOND], // year definition (Julian calendar) from https://www.iau.org/publications/proceedings_rules/units/

	't':   [1000*1000,  1, Unit.GRAM],
	'u':   [1, 1_660_540_000_000_000_052_570_466_811_904n, Unit.GRAM], // atomic mass

	'au':  [149_598_000_000, 		1, Unit.METRE], // astronomical unit
	'pc':  [30_857_000_000_000_000n, 1, Unit.METRE], // parsec

	'Cyr':  [12, 1, Unit.CMO], // 1 calendar year = 12 calendar months
	'Ca':   [12, 1, Unit.CMO],

} as const;


export type UnitAliasUnits = {
	[k in keyof typeof UnitAliases]: typeof UnitAliases[k][2]
}

// reverse mapping for all aliases of a unit e.g. Unit.SECOND -> "min" | "h" | "d" | "a" | "yr"
export type UnitAliasesMap = {
	[key in UnitAliasUnits[keyof UnitAliasUnits]]: {
		[k in keyof UnitAliasUnits]: UnitAliasUnits[k] extends key ? k : never
	}[keyof UnitAliasUnits]
}


// prefixes -----------------------------------------------------------------------------------------

// exponents (int8)

export enum UnitPrefixCode {

	YOTTA  = 24,  // 10 ^ 24
	ZETTA  = 21,  // 10 ^ 21
	EXA    = 18,  // 10 ^ 18
	PETA   = 15,  // 10 ^ 15
	TERRA  = 12,  // 10 ^ 12
	GIGA   = 9,  // 10 ^ 9
	MEGA   = 6,  // 10 ^ 6
	KILO   = 3,  // 10 ^ 3
	HECTO  = 2,  // 10 ^ 2
	DECA   = 1,  // 10 ^ 1

	DECI   = -1,  // 10 ^ -1
	CENTI  = -2,  // 10 ^ -2
	MILLI  = -3,  // 10 ^ -3
	MICRO  = -6,  // 10 ^ -6
	NANO   = -9,  // 10 ^ -9
	PICO   = -12,  // 10 ^ -12
	FEMTO  = -15,  // 10 ^ -15
	ATTO   = -18,  // 10 ^ -18
	ZEPTO  = -21,  // 10 ^ -21
	YOCTO  = -24,  // 10 ^ -24
}


export const UnitPrefixSymbol =  {

	[UnitPrefixCode.YOTTA]: 'Y',
	[UnitPrefixCode.ZETTA]: 'Z',
	[UnitPrefixCode.EXA]: 	'E',
	[UnitPrefixCode.PETA]: 	'P',
	[UnitPrefixCode.TERRA]: 'T',
	[UnitPrefixCode.GIGA]: 	'G',
	[UnitPrefixCode.MEGA]: 	'M',
	[UnitPrefixCode.KILO]: 	'k',
	[UnitPrefixCode.HECTO]: 'h',
	[UnitPrefixCode.DECA]: 	'da',

	[UnitPrefixCode.DECI]: 	'd',
	[UnitPrefixCode.CENTI]: 'c',
	[UnitPrefixCode.MILLI]: 'm',
	[UnitPrefixCode.MICRO]: 'u',
	[UnitPrefixCode.NANO]:  'n',
	[UnitPrefixCode.PICO]: 	'p',
	[UnitPrefixCode.FEMTO]: 'f',
	[UnitPrefixCode.ATTO]: 	'a',
	[UnitPrefixCode.ZEPTO]: 'z',
	[UnitPrefixCode.YOCTO]: 'y',

} as const;

export const UnitPrefixCodeBySymbol =  {

	'Y': 	UnitPrefixCode.YOTTA,
	'Z': 	UnitPrefixCode.ZETTA,
	'E': 	UnitPrefixCode.EXA,
	'P': 	UnitPrefixCode.PETA,
	'T': 	UnitPrefixCode.TERRA,
	'G': 	UnitPrefixCode.GIGA,
	'M': 	UnitPrefixCode.MEGA,
	'k': 	UnitPrefixCode.KILO,
	'h': 	UnitPrefixCode.HECTO,
	'da': 	UnitPrefixCode.DECA,

	'd': 	UnitPrefixCode.DECI,
	'c': 	UnitPrefixCode.CENTI,
	'm': 	UnitPrefixCode.MILLI,
	'u': 	UnitPrefixCode.MICRO,
	'n': 	UnitPrefixCode.NANO,
	'p': 	UnitPrefixCode.PICO,
	'f': 	UnitPrefixCode.FEMTO,
	'a': 	UnitPrefixCode.ATTO,
	'z': 	UnitPrefixCode.ZEPTO,
	'y': 	UnitPrefixCode.YOCTO,

} as const;




// auto-generated types -----------------------------------------------------------------------------------------

// helpers
type OptionalPropertyNames<T> = { [K in keyof T]: undefined extends T[K] ? K : never }[keyof T];
type SpreadProperties<L, R, K extends keyof L & keyof R> = { [P in K]: L[P] | Exclude<R[P], undefined> };
type Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never
// { ...L, ...R }
type Combine<L, R> = Id<
  Pick<L, Exclude<keyof L, keyof R>> & 
  SpreadProperties<L, R, OptionalPropertyNames<R> & keyof L>
>;

export type unit_factor = [Unit, number];
export type unit = unit_factor[];

export type unit_base_symbol = keyof typeof UnitCodeBySymbol;
// all allowed symbols (s,m,h,EUR,€,...)
export type unit_symbol = unit_base_symbol | keyof typeof UnitCodeBySymbolShortForms | keyof typeof UnitAliases;
// all allowed prefixes (k,c,m,...)
export type unit_prefix = keyof typeof UnitPrefixCodeBySymbol;


export type code_to_symbol<C extends Unit> = typeof UnitSymbol[C] | typeof UnitSymbolShortFormsByCode[C & keyof typeof UnitSymbolShortFormsByCode];
export type symbol_to_code = typeof UnitCodeBySymbol & UnitAliasUnits & typeof UnitCodeBySymbolShortForms;

export type symbol_prefix_combinations<S extends string> = S|`${unit_prefix}${S}`

export type code_to_extended_symbol<C extends Unit = Unit> = C extends null ? string : symbol_prefix_combinations<code_to_symbol<C>|UnitAliasesMap[C & keyof UnitAliasesMap]>
export type symbol_with_prefix = unit_symbol|`${unit_prefix}${unit_symbol}`