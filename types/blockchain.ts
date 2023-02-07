// Blockchain

import { INVALID } from "../runtime/constants.ts";
import { Type } from "./type.ts";

export class BlockchainTransaction {

    constructor(public transaction:{data:any, type:number} = {data:undefined, type:0}) {

    }
}



// <Block>
Type.std.Transaction.setJSInterface({
    class: BlockchainTransaction,

    serialize: (value:BlockchainTransaction) => value.transaction,

    empty_generator: ()=>new BlockchainTransaction(),

    cast: value => {
        if (value instanceof Object) return new BlockchainTransaction(value);
        return INVALID;
    }
})

