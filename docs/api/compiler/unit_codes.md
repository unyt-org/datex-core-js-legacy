## type **unit_factor** = [Unit, number]

## type **unit** = unit_factor[]

## type **unit_base_symbol** = unknown - todo

## type **unit_symbol** = unit_base_symbol | unknown - todo | unknown - todo

## type **unit_prefix** = unknown - todo

## type **code_to_symbol** = Combine

## type **symbol_to_code** = Combine

## type **code_to_extended_symbol**\<C extends Unit = Unit> = C extends null ? string : unknown - todo | ${unit_prefix}${code_to_symbol[C]}

## type **symbol_with_prefix** = unit_symbol | ${unit_prefix}${unit_symbol}

## enum **Unit**

## enum **UnitPrefixCode**

## const **UnitSymbol**: {[Unit.SECOND]: string,[Unit.METRE]: string,[Unit.GRAM]: string,[Unit.AMPERE]: string,[Unit.KELVIN]: string,[Unit.MOLE]: string,[Unit.CANDELA]: string,[Unit.EUR]: string,[Unit.USD]: string,[Unit.GBP]: string,[Unit.RUB]: string,[Unit.CNY]: string,[Unit.JPY]: string,[Unit.UNYT]: string,[Unit.DIMENSIONLESS]: string,[Unit.CMO]: string,}

## const **UnitCodeBySymbol**: {s: any,m: any,g: any,A: any,K: any,mol: any,cd: any,EUR: any,USD: any,GBP: any,RUB: any,CNY: any,JPY: any,UNYT: any,x: any,1: any,Cmo: any,}

## const **UnitCodeBySymbolShortForms**: {€: any,$: any,£: any,₽: any,¥: any,}

## const **UnitSymbolShortFormsByCode**: {[Unit.EUR]: string,[Unit.USD]: string,[Unit.GBP]: string,[Unit.RUB]: string,[Unit.CNY]: string,}

## const **DerivedUnits**: {rad: any[][],sr: any[][],N: any[],Hz: any[],Pa: any[],J: any,W: any[],C: any[][],V: any[],F: any[],O: any[],Ω: any[],S: any[],Wb: any[],T: any[],H: any[],lm: any[][],lx: any[],Bq: any[],Gy: any[],kat: any[],l: any[][],eV: any[],}

## const **UnitAliases**: {min: any[],h: any[],d: any[],a: any[],yr: any[],t: any[],u: any[],au: any[],pc: any[],Cyr: any[],Ca: any[],}

## const **UnitPrefixSymbol**: {[UnitPrefixCode.YOTTA]: string,[UnitPrefixCode.ZETTA]: string,[UnitPrefixCode.EXA]: string,[UnitPrefixCode.PETA]: string,[UnitPrefixCode.TERRA]: string,[UnitPrefixCode.GIGA]: string,[UnitPrefixCode.MEGA]: string,[UnitPrefixCode.KILO]: string,[UnitPrefixCode.HECTO]: string,[UnitPrefixCode.DECA]: string,[UnitPrefixCode.DECI]: string,[UnitPrefixCode.CENTI]: string,[UnitPrefixCode.MILLI]: string,[UnitPrefixCode.MICRO]: string,[UnitPrefixCode.NANO]: string,[UnitPrefixCode.PICO]: string,[UnitPrefixCode.FEMTO]: string,[UnitPrefixCode.ATTO]: string,[UnitPrefixCode.ZEPTO]: string,[UnitPrefixCode.YOCTO]: string,}

## const **UnitPrefixCodeBySymbol**: {Y: any,Z: any,E: any,P: any,T: any,G: any,M: any,k: any,h: any,da: any,d: any,c: any,m: any,u: any,n: any,p: any,f: any,a: any,z: any,y: any,}

