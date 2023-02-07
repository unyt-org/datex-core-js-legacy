var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Assert } from "../../unyt_tests/testing/assertions.ts";
import { Test } from "../../unyt_tests/testing/test.ts";
import { Datex } from "../datex.ts";
import { $$ } from "../datex_short.ts";
const a = {
    a: 1,
    b: 'text',
    c: true,
    d: [1, 2, 3, 4, 5],
    e: new Map(),
    f: new Set(),
    g: { a: 1, b: 2, c: [1, 2, 3] },
};
let DatexJSONObjects = class DatexJSONObjects {
    objectsAreInitializedCorrectly() {
        const ref_a = $$(a);
        Assert.false(ref_a === a);
        Assert.hasProperty(ref_a, Datex.DX_PTR);
        Assert.hasProperty(a, Datex.DX_PTR);
        Assert.equalsStrict(ref_a[Datex.DX_PTR].type, Datex.Type.std.Object);
    }
    objectPropertiesAreInitializedCorrectly() {
    }
};
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DatexJSONObjects.prototype, "objectsAreInitializedCorrectly", null);
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DatexJSONObjects.prototype, "objectPropertiesAreInitializedCorrectly", null);
DatexJSONObjects = __decorate([
    Test
], DatexJSONObjects);
