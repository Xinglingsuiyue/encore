import plugin from '../../../lib/plugins/plugin.js'
import fs from 'fs'
import path from 'path'
import { pluginResources } from '../model/path.js'

/** encore.moe API v2 数据端点映射 */
const API_BASE = 'https://api-v2.encore.moe/api/zh-Hans'
const DATA_DIR = path.join(pluginResources, 'data', 'encore')
const DETAIL_DIR = path.join(DATA_DIR, 'details')

const ENDPOINTS = {
    character: { path: 'character', key: 'roleList', desc: '角色', hasDetail: true },
    weapon:     { path: 'weapon',    key: 'weapons',    desc: '武器', hasDetail: true },
    echo:       { path: 'echo',      key: 'Echo',       desc: '声骸', hasDetail: true },
    monster:    { path: 'monster',   key: 'monsterList', desc: '怪物', hasDetail: true },
    namecard:   { path: 'namecard',  key: 'namecardList', desc: '名片', hasDetail: true },
    title:      { path: 'title',     key: 'titleList',    desc: '称号', hasDetail: true },
    fotg:       { path: 'fotg',      key: null,           desc: '千道门扉异想', hasDetail: true },
    whiwa:      { path: 'whiwa',     key: null,           desc: '冥歌海墟',     hasDetail: true },
    dpmatrix:   { path: 'dpmatrix',  key: null,           desc: '终焉矩阵',     hasDetail: true },
    toa:        { path: 'toa',       key: 'seasons',      desc: '逆境深塔',     hasDetail: true }
}

const ID_FIELDS = { character: 'Id', weapon: 'Id', echo: 'Id', monster: 'Id', namecard: 'Id', title: 'Id', fotg: 'Id', whiwa: 'Season', dpmatrix: 'Season', toa: 'id' }

/* ========== 工具函数 ========== */

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getDataPath(name) {
    return path.join(DATA_DIR, `${name}.json`)
}

function getDetailDir(type) {
    return path.join(DETAIL_DIR, type)
}

function getDetailPath(type, id) {
    return path.join(DETAIL_DIR, type, `${id}.json`)
}

function writeJSON(filePath, data) {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
}

function readJSON(filePath) {
    if (!fs.existsSync(filePath)) return null
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
    catch { return null }
}

function getMeta() {
    return readJSON(path.join(DATA_DIR, '_meta.json')) || {}
}

function saveMeta(meta) {
    writeJSON(path.join(DATA_DIR, '_meta.json'), meta)
}

function rmdirRecursive(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) rmdirRecursive(p)
        else fs.unlinkSync(p)
    }
    fs.rmdirSync(dir)
}

/* ========== 对外导出 — 查询模块使用 ========== */

export function readLocalData(name) {
    return readJSON(getDataPath(name))
}

/** 读取本地详情（不存在返回 null） */
export function readLocalDetail(type, id) {
    return readJSON(getDetailPath(type, id))
}

/** 保存单条详情到本地（供查询模块回写 API 结果） */
export function saveLocalDetail(type, id, data) {
    writeJSON(getDetailPath(type, id), data)
}

/* ========== EncoreSync 插件类 ========== */

export class EncoreSync extends plugin {
    constructor() {
        super({
            name: '鸣潮-Encore数据管理',
            event: 'message',
            priority: 1010,
            rule: [
                {
                    reg: '^(?:～|~|鸣潮)?下载encore(?:所有)?资源$',
                    fnc: 'downloadAll'
                },
                {
                    reg: '^(?:～|~|鸣潮)?删除encore(?:所有)?资源$',
                    fnc: 'deleteAll'
                },
                {
                    reg: '^(?:～|~|鸣潮)?更新encore(?:所有)?资源$',
                    fnc: 'updateAll'
                },
                {
                    reg: '^(?:～|~|鸣潮)?encore资源状态$',
                    fnc: 'showStatus'
                }
            ]
        })
    }

    async _fetch(url) {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://encore.moe',
                'Referer': 'https://encore.moe/'
            }
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
    }

    async downloadList(name, config) {
        const url = `${API_BASE}/${config.path}`
        console.log(`[EncoreSync] 下载列表: ${name}`)
        const raw = await this._fetch(url)
        const data = config.key === null ? raw : raw[config.key]
        if (!data && config.key !== null) throw new Error(`缺少字段 "${config.key}"`)
        writeJSON(getDataPath(name), data)
        const count = Array.isArray(data) ? data.length : Object.keys(data).length
        console.log(`[EncoreSync] ${name} 列表完成: ${count} 条`)
        return { count, data }
    }

    async downloadDetail(type, id) {
        const url = `${API_BASE}/${type}/${id}`
        try {
            const data = await this._fetch(url)
            writeJSON(getDetailPath(type, id), data)
            return { success: true, id }
        } catch (e) {
            return { success: false, id, error: e.message }
        }
    }

    async downloadAllDetails(type, items) {
        const idField = ID_FIELDS[type] || 'Id'
        const total = items.length
        let ok = 0, fail = 0
        const batchSize = 5

        ensureDir(getDetailDir(type))
        console.log(`[EncoreSync] 开始下载 ${type} 详情，共 ${total} 条`)

        for (let i = 0; i < total; i += batchSize) {
            const batch = items.slice(i, i + batchSize)
            const tasks = batch.map(item => {
                const id = item[idField]
                if (!id) return Promise.resolve({ success: false, id: '?', error: '无ID' })
                return this.downloadDetail(type, id)
            })
            const results = await Promise.all(tasks)
            for (const r of results) {
                if (r.success) ok++
                else fail++
            }
            if ((i + batchSize) % 50 === 0 || i + batchSize >= total) {
                console.log(`[EncoreSync] ${type} 详情: ${Math.min(i + batchSize, total)}/${total}`)
            }
        }
        console.log(`[EncoreSync] ${type} 详情完成: ${ok}/${total}, 失败${fail}`)
        return { ok, fail }
    }

    /* ========== 玩家指令 ========== */

    async downloadAll(e) {
        if (!e.isMaster) return e.reply('仅主人可使用此命令')
        await e.reply('开始下载 encore 所有资源…\n列表 → 角色... ')

        const meta = { downloadedAt: new Date().toISOString(), endpoints: {}, details: {} }
        const results = []

        for (const [name, config] of Object.entries(ENDPOINTS)) {
            try {
                const { count, data } = await this.downloadList(name, config)
                results.push({ success: true, name, count })
                meta.endpoints[name] = { count, downloadedAt: meta.downloadedAt }

                if (config.hasDetail && Array.isArray(data) && data.length > 0) {
                    const dr = await this.downloadAllDetails(name, data)
                    meta.details[name] = {
                        total: data.length,
                        ok: dr.ok,
                        fail: dr.fail,
                        downloadedAt: new Date().toISOString()
                    }
                }

                // fotg 额外下载 buffpool
                if (name === 'fotg') {
                    try {
                        const bpUrl = `${API_BASE}/fotg/buffpool`
                        const bpData = await this._fetch(bpUrl)
                        writeJSON(getDataPath('fotg_buffpool'), bpData)
                        console.log(`[EncoreSync] fotg buffpool 下载完成: ${Array.isArray(bpData) ? bpData.length : '?'} 条`)
                    } catch (e) {
                        console.error('[EncoreSync] fotg buffpool 下载失败:', e.message)
                    }
                }
            } catch (err) {
                results.push({ success: false, name, error: err.message })
            }
        }

        saveMeta(meta)

        const ok = results.filter(r => r.success).length
        const failList = results.filter(r => !r.success).map(r => `${r.name}(${r.error})`)

        let msg = `下载完成！列表: ${ok}/${results.length}`
        if (failList.length > 0) msg += `\n失败: ${failList.join(', ')}`
        msg += `\n\n详情数据:`
        for (const [type, info] of Object.entries(meta.details || {})) {
            msg += `\n  ${ENDPOINTS[type]?.desc || type}: ${info.ok}/${info.total}`
            if (info.fail > 0) msg += ` (失败${info.fail})`
        }
        msg += `\n数据保存在...`
        await e.reply(msg)
    }

    async deleteAll(e) {
        if (!fs.existsSync(DATA_DIR)) {
            return e.reply('encore 资源目录不存在，无需删除')
        }
        try {
            let fileCount = 0
            const countDir = (dir) => {
                if (!fs.existsSync(dir)) return
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.isDirectory()) countDir(path.join(dir, entry.name))
                    else fileCount++
                }
            }
            countDir(DATA_DIR)
            rmdirRecursive(DATA_DIR)
            e.reply(`已删除全部 encore 资源（共 ${fileCount} 个文件）`)
        } catch (err) {
            console.error('[EncoreSync] 删除失败:', err)
            e.reply('删除资源时出错，请查看控制台')
        }
    }

    /** 增量更新单个端点：对比新旧列表，仅下载新增/变更的详情 */
    async _updateEndpoint(name, config, meta) {
        const idField = ID_FIELDS[name] || 'Id'
        const oldData = readJSON(getDataPath(name))
        const oldIds = new Set(Array.isArray(oldData) ? oldData.map(d => String(d[idField])) : [])

        // 拉取最新列表
        const { count, data } = await this.downloadList(name, config)
        const items = Array.isArray(data) ? data : []
        const newIds = new Set(items.map(d => String(d[idField])))

        // 计算新增
        const added = items.filter(d => !oldIds.has(String(d[idField])))
        const removed = [...oldIds].filter(id => !newIds.has(id))
        const unchanged = items.length - added.length

        // 计算新增 + 缺失详情（对比磁盘上实际文件与期望 ID 列表）
        let toDownload = []
        let missingCount = 0
        if (config.hasDetail) {
            ensureDir(getDetailDir(name))
            const addedIds = new Set(added.map(d => String(d[idField])).filter(Boolean))
            toDownload = [...added]

            // 直接对比磁盘文件：找出期望 ID 中缺失的
            const expectedIds = new Set(items.map(d => String(d[idField])).filter(Boolean))
            const existingIds = new Set(
                fs.existsSync(getDetailDir(name))
                    ? fs.readdirSync(getDetailDir(name)).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
                    : []
            )
            const missingIds = [...expectedIds].filter(id => !existingIds.has(id) && !addedIds.has(id))
            missingCount = missingIds.length
            if (missingIds.length > 0) {
                console.log(`[EncoreSync] ${name} 缺失详情 ID: ${missingIds.join(', ')}`)
                const missingItems = items.filter(d => missingIds.includes(String(d[idField])))
                toDownload.push(...missingItems)
            }
        }

        let detailResult = { ok: 0, fail: 0 }
        if (config.hasDetail && toDownload.length > 0) {
            console.log(`[EncoreSync] ${name} 增量下载详情: 新增 ${added.length}, 补缺 ${missingCount}`)
            detailResult = await this.downloadAllDetails(name, toDownload)
        }

        // fotg 额外增量更新 buffpool
        if (name === 'fotg') {
            try {
                const bpUrl = `${API_BASE}/fotg/buffpool`
                const bpData = await this._fetch(bpUrl)
                writeJSON(getDataPath('fotg_buffpool'), bpData)
                console.log(`[EncoreSync] fotg buffpool 更新完成: ${Array.isArray(bpData) ? bpData.length : '?'} 条`)
            } catch (e) {
                console.error('[EncoreSync] fotg buffpool 更新失败:', e.message)
            }
        }

        // 更新 meta — 重新统计磁盘上实际文件数
        meta.endpoints[name] = { count, downloadedAt: new Date().toISOString() }
        if (config.hasDetail) {
            let actualOk = 0
            if (fs.existsSync(getDetailDir(name))) {
                actualOk = fs.readdirSync(getDetailDir(name)).filter(f => f.endsWith('.json')).length
            }
            meta.details[name] = {
                total: items.length,
                ok: actualOk,
                fail: items.length - actualOk,
                downloadedAt: new Date().toISOString()
            }
        }

        return { name, added: added.length, missing: missingCount, removed: removed.length, unchanged, total: items.length, detailOk: detailResult.ok, detailFail: detailResult.fail }
    }

    async updateAll(e) {
        const meta = getMeta()
        if (Object.keys(meta.endpoints || {}).length === 0) {
            return e.reply('尚未下载过 encore 资源，请先使用 ~下载encore资源')
        }

        await e.reply('开始增量更新 encore 资源…\n检测新增内容 + 补全缺失的详情文件')

        const results = []
        const now = new Date().toISOString()
        meta.downloadedAt = now
        if (!meta.details) meta.details = {}

        for (const [name, config] of Object.entries(ENDPOINTS)) {
            try {
                const r = await this._updateEndpoint(name, config, meta)
                results.push({ success: true, ...r })
            } catch (err) {
                results.push({ success: false, name, error: err.message })
            }
        }

        saveMeta(meta)

        let msg = `增量更新完成！\n`
        for (const r of results) {
            const desc = ENDPOINTS[r.name]?.desc || r.name
            if (r.success) {
                msg += `\n✅ ${desc}: 新增 ${r.added}, 移除 ${r.removed}, 未变 ${r.unchanged} (共 ${r.total})`
                if (r.missing > 0) msg += `  补缺 ${r.missing}`
                if (r.detailOk > 0) msg += `  详情 +${r.detailOk}`
                if (r.detailFail > 0) msg += ` (失败${r.detailFail})`
            } else {
                msg += `\n❌ ${desc}: ${r.error}`
            }
        }
        await e.reply(msg)
    }

    async showStatus(e) {
        const meta = getMeta()
        if (!fs.existsSync(DATA_DIR)) {
            return e.reply('encore 资源尚未下载，请使用 ~下载encore资源')
        }

        let msg = '📦 Encore 资源状态:\n'
        msg += `下载时间: ${meta.downloadedAt || '未知'}\n\n`

        for (const [name, config] of Object.entries(ENDPOINTS)) {
            const listPath = getDataPath(name)
            if (fs.existsSync(listPath)) {
                const sizeKB = (fs.statSync(listPath).size / 1024).toFixed(1)
                const mi = meta.endpoints?.[name]
                const countStr = mi?.count ? ` (${mi.count}条)` : ''
                msg += `✅ ${config.desc}: ${sizeKB}KB${countStr}`

                if (config.hasDetail) {
                    const di = meta.details?.[name]
                    const detailDir = getDetailDir(name)
                    if (di && fs.existsSync(detailDir)) {
                        const files = fs.readdirSync(detailDir).filter(f => f.endsWith('.json'))
                        msg += `  详情: ${files.length}/${di.total}`
                        if (di.fail > 0) msg += ` ⚠️ 失败${di.fail}`
                    } else {
                        msg += `  详情: 未下载`
                    }
                }
                msg += '\n'
            } else {
                msg += `❌ ${config.desc}: 未下载\n`
            }
        }
        await e.reply(msg)
    }
}