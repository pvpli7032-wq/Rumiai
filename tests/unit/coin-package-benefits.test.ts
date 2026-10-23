import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePackageConfiguration} from '@rumiai/backend/modules/coins/package-management';
import {coinOrderSnapshot} from '@rumiai/backend/modules/payments/order-service';

test('coin package benefits are validated and copied into an immutable order snapshot', () => {
  const pkg = validatePackageConfiguration({label: '测试套餐', coins: 100, bonus: 20, benefits: ['专属徽章', '活动资格'], priceCnyCents: 999, sortOrder: 0, isActive: true, bonusStartsAt: null, bonusEndsAt: null});
  assert.equal(pkg.benefitsJson, '["专属徽章","活动资格"]');
  assert.deepEqual(coinOrderSnapshot({...pkg, benefitsJson: pkg.benefitsJson!}), {packageCoins: 100, packageBonus: 20, packageBenefitsJson: pkg.benefitsJson, coinAmount: 120, amountCnyCents: 999});
  assert.throws(() => validatePackageConfiguration({...pkg, benefits: Array(9).fill('权益')}), /最多 8 条/);
  assert.throws(() => validatePackageConfiguration({...pkg, benefits: ['重复', '重复']}), /不能重复/);
});
