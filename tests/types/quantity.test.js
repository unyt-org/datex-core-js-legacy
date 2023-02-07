var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Test } from "../../../unyt_tests/testing/test.ts";
import { Assert } from "../../../unyt_tests/testing/assertions.ts";
import { Quantity } from "../../datex_all.ts";
const m1 = new Quantity(60, 'km');
const m2 = new Quantity(60, 'km');
const m3 = new Quantity('1/3', 'm');
const s1 = new Quantity(60, 's');
let QuantityTests = class QuantityTests {
    unitsAreInitializedCorrectly() {
        Assert.true(m1.hasBaseUnit('m'));
        Assert.true(s1.hasBaseUnit('s'));
    }
    valuesAreInitializedCorrectly() {
        Assert.equals(m1.value, 60000);
        Assert.equals(m3.value, 1 / 3);
    }
    async comparisonsWorkCorrectly() {
        Assert.true(m1.equals(m2));
        Assert.false(m1.equals(s1));
        await Assert.sameValueAsync(m1, m2);
    }
    additionWorksCorrectly() {
        const sum1 = m1.sum(m2);
        Assert.true(sum1.equals(new Quantity(120, 'km')));
        const sum2 = sum1.sum(new Quantity('2/3', 'nm'));
        Assert.true(sum2.equals(new Quantity('180000000000001/1500000000', 'm')));
    }
    subtractionWorksCorrectly() {
        const diff1 = m1.difference(m2);
        Assert.true(diff1.equals(new Quantity(0, 'km')));
        const diff2 = diff1.difference(new Quantity('2/3', 'nm'));
        Assert.true(diff2.equals(new Quantity('-2/3', 'nm')));
    }
};
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], QuantityTests.prototype, "unitsAreInitializedCorrectly", null);
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], QuantityTests.prototype, "valuesAreInitializedCorrectly", null);
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], QuantityTests.prototype, "comparisonsWorkCorrectly", null);
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], QuantityTests.prototype, "additionWorksCorrectly", null);
__decorate([
    Test,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], QuantityTests.prototype, "subtractionWorksCorrectly", null);
QuantityTests = __decorate([
    Test
], QuantityTests);
