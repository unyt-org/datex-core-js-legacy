## namespace **Quantity**
let x:Unit.METRE = new Unit(11, "cm");
let x:Unit.EUR   = new Unit(10000, "€");

## type **Quantity.SECOND** = Quantity

## type **Quantity.METRE** = Quantity

## type **Quantity.GRAM** = Quantity

## type **Quantity.AMPERE** = Quantity

## type **Quantity.KELVIN** = Quantity

## type **Quantity.MOLE** = Quantity

## type **Quantity.CANDELA** = Quantity

## type **Quantity.CMO** = Quantity

## type **Quantity.EUR** = Quantity

## type **Quantity.USD** = Quantity

## type **Quantity.GBP** = Quantity

## type **Quantity.RUB** = Quantity

## type **Quantity.JPY** = Quantity

## type **Quantity.CNY** = Quantity

## enum **Quantity.Formatting**

## class **Quantity**\<U extends Unit | undefined = undefined>
### Constructors
 **constructor**(value?: number | bigint | string | [number | bigint, number | bigint], unit?: U extends Unit ? code_to_extended_symbol : unknown)

 * @param value: can be a number, bigint, or string: '1.25', '1', '0.5e12', '1/10', or [numerator, denominator]
 * @param unit: undefined
 **constructor**(value?: number | bigint | string | [number | bigint, number | bigint], encoded_unit?: unit)

 **constructor**(value: number | bigint | string | [number | bigint, number | bigint], symbol_or_encoded_unit: string | unit)

### Properties
**cached_binaries**: Map<br>
**known_aliases**: string | bigint[] | string[][]<br>
**EXPONENT_MIN**: any<br>
**EXPONENT_MAX**: number<br>
**unit**: unit<br>
**unit_binary**: ArrayBuffer<br>
**unit_formatted**: string<br>
**unit_formatted_short**: string<br>
**short_divisor**: bigint<br>


