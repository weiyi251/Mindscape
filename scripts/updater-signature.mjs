// ============================================================================
// 模块说明（中文）
// 自动更新签名文件的读取、形态校验与归一化。
//
// ⚠️ 关键事实（2026-09-28 实测确认，别再改回去）：
//   `tauri signer sign` 生成的 .sig 文件是**单行 base64**（本项目产物 420 字节、无换行），
//   它 base64 解码之后才是标准 minisign 的四行签名：
//     untrusted comment: signature from tauri secret key
//     <base64：alg(2 字节) + keyId(8 字节) + 签名(64 字节)>
//     trusted comment: timestamp:1789946523\tfile:Mindscape_0.9.0_x64-setup.exe
//     <base64：可信注释上的全局签名>
//   而 latest.json 的 signature 字段，内容就是 .sig 里那整串 base64
//   （updater 会先 base64 解码再验签）。
//   所以「.sig 看起来像一段没有换行的乱码」**不是错误** —— 2026-09-28 排查自动更新
//   时曾据此误判为「双重 base64」，差点把正确的资产重写成明文（那样反而会让 updater
//   解析失败）。本模块把这个形态钉死，并捎带校验签名所属文件名。
//
// 纯函数、零依赖，与 scripts/release.mjs 解耦（后者一 import 就会触发构建）。
// ============================================================================

/** 四行签名里 trusted comment 的行前缀 */
const UNTRUSTED_PREFIX = 'untrusted comment:'
const TRUSTED_PREFIX = 'trusted comment:'
const EXPECTED_LINES = 4

/**
 * 从 trusted comment 里取出被签文件名（`file:xxx` 段）。
 * 行形如：`trusted comment: timestamp:1789946523\tfile:Mindscape_0.9.0_x64-setup.exe`
 */
export function signedFileNameOf(trustedLine) {
  const marked = trustedLine.split('file:')
  return marked.length > 1 ? marked[marked.length - 1].trim() : ''
}

function fail(reason) {
  throw new Error(
    `更新签名文件形态不对：${reason}\n` +
      '预期是 tauri signer sign 生成的单行 base64（解码后 4 行 minisign 签名文本）。'
  )
}

/**
 * 读取 .sig 内容，归一化为写进 latest.json 的 signature（= 四行签名文本的 base64）。
 *
 * @param {string} raw      .sig 文件的原始内容
 * @param {object} [options]
 * @param {string} [options.expectFile] 期望该签名对应的文件名；与 trusted comment 不一致时报错
 * @returns {string} 归一化后的签名文本
 */
export function readUpdaterSignature(raw, options = {}) {
  const text = String(raw ?? '').trim()
  if (!text) fail('内容为空')

  // 两种形态都要忍：① CLI 产出的单行 base64；② 已被人解码过的明文四行
  const alreadyPlain = text.startsWith(UNTRUSTED_PREFIX)
  let plain = text
  if (!alreadyPlain) {
    let decoded
    try {
      decoded = Buffer.from(text, 'base64').toString('utf8')
    } catch {
      fail('既不是明文签名，也无法按 base64 解码')
    }
    // 反向校验：重新编码必须回到原文，否则说明这串 base64 里有非法内容
    if (!decoded.startsWith(UNTRUSTED_PREFIX) || Buffer.from(decoded, 'utf8').toString('base64') !== text) {
      fail('base64 解码后不是 minisign 签名文本，或编码不可逆（可能被文本工具改过换行）')
    }
    plain = decoded
  }

  const lines = plain.trim().split('\n')
  if (lines.length !== EXPECTED_LINES) fail(`解码后是 ${lines.length} 行，应为 ${EXPECTED_LINES} 行`)
  if (!lines[0].startsWith(UNTRUSTED_PREFIX)) fail('第 1 行不是 untrusted comment')
  if (!lines[2].startsWith(TRUSTED_PREFIX)) fail('第 3 行不是 trusted comment')

  if (options.expectFile) {
    const signed = signedFileNameOf(lines[2])
    if (signed && signed !== options.expectFile) {
      fail(`签名属于 ${signed}，与安装包 ${options.expectFile} 不符（可能拿错了旧版本的 .sig）`)
    }
  }

  return Buffer.from(plain.trim() + '\n', 'utf8').toString('base64')
}
