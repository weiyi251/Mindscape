// ============================================================================
// 模块说明（中文）
// 更新签名形态的回归防线。
//
// 样本取自 v0.9.0 Release 上真实发布的 .sig 资产（已在 <= 本文件编写时 经线上验签通过的产物）：
//   Mindscape_0.9.0_x64-setup.exe.sig      → 自动更新通道目前的更新包签名
//   Mindscape_0.9.0_x64_en-US.msi.sig      → 2026-09-28 补签上传，MSI 资产从此也有签名
// 之所以锁形态：2026-09-28 排查自动更新时，曾把「单行 base64 的 .sig」误判成
// 「双重 base64 的错误内容」，差点重写正确的资产。这里用真实样本把它钉住。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { readUpdaterSignature, signedFileNameOf } from './updater-signature.mjs'

/** 真实样本：NSIS 安装包的签名（截图自 Release 资产，不得随手改动） */
const NSIS_SIG =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTT3dpbTUxVjM3Z3lXT0tBWHE1UlFvem5UWGp6RkJTM0Z0TXJ2bTNydFNTRzhDZVdxcUZYcXZiVHBuMjltT1NBY1JrWHJOcTljMlVYZHo2MWlaMU5nOXgxbkR5RUdCYmdJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5OTQ2NTIzCWZpbGU6TWluZHNjYXBlXzAuOS4wX3g2NC1zZXR1cC5leGUKOU1yTHFLMUt0S2ozZzY5MnpXNTFVYmpXOXdkNGhWQTVIVWpmaHhiYnc1T0pncEJWbG1KRGFmVkprYTN0MFp3dEY3aE10dU01NUY3Z2s3TDVvMGxLQnc9PQo='

/** 真实样本：MSI 安装包的签名 */
const MSI_SIG =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTT3dpbTUxVjM3ZzNQN0VkQzFMeE9sRk9EelZPNUE1S0xwd1RNYlhEN1BJZkdTR3NUVWhYVThpanYySSs2cVNQd3lSdWhTK2ozMGowVnlDdGRIQWxueUQvZ0FmQ1JjQXd3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwNTMxNDE5CWZpbGU6TWluZHNjYXBlXzAuOS4wX3g2NF9lbi1VUy5tc2kKeXcvSm41ejRKU3JYZHFRalZSMzBmcUlvL1dTT0tCVnAxV0gwZng1TmdWeDJXTUNvWExNbmxibnFuMzI0K1EwU2haNXZocU83UHFKTnhJMHUwdWVFQ1E9PQo='

const NSIS_FILE = 'Mindscape_0.9.0_x64-setup.exe'
const MSI_FILE = 'Mindscape_0.9.0_x64_en-US.msi'

describe('readUpdaterSignature', () => {
  it('原样透传 CLI 生成的单行 base64（round-trip 不变）', () => {
    expect(readUpdaterSignature(NSIS_SIG, { expectFile: NSIS_FILE })).toBe(NSIS_SIG)
    expect(readUpdaterSignature(MSI_SIG, { expectFile: MSI_FILE })).toBe(MSI_SIG)
  })

  it('容错：已被解码成明文四行时也能归一回同一串 base64', () => {
    const plain = Buffer.from(NSIS_SIG, 'base64').toString('utf8')
    expect(readUpdaterSignature(plain, { expectFile: NSIS_FILE })).toBe(NSIS_SIG)
  })

  it('容错：文件首尾多出空白与换行不影响结果', () => {
    expect(readUpdaterSignature(`  \n${NSIS_SIG}\n\n`, { expectFile: NSIS_FILE })).toBe(NSIS_SIG)
  })

  it('能从 trusted comment 里读出被签文件名', () => {
    const plain = Buffer.from(NSIS_SIG, 'base64').toString('utf8').split('\n')
    expect(signedFileNameOf(plain[2])).toBe(NSIS_FILE)
  })

  it('签名与安装包对不上时报错（防拿错旧版本的 .sig）', () => {
    expect(() => readUpdaterSignature(NSIS_SIG, { expectFile: MSI_FILE })).toThrow(/不符/)
  })

  it('内容为空 / 不是签名文本 / 缺行时一律报错', () => {
    expect(() => readUpdaterSignature('')).toThrow(/为空/)
    expect(() => readUpdaterSignature('这不是签名')).toThrow(/形态不对/)
    // 四行里砍掉最后一行（缺全局签名）
    const broken = Buffer.from(
      Buffer.from(NSIS_SIG, 'base64')
        .toString('utf8')
        .split('\n')
        .slice(0, 3)
        .join('\n'),
      'utf8'
    ).toString('base64')
    expect(() => readUpdaterSignature(broken)).toThrow(/应为 4 行/)
  })
})
