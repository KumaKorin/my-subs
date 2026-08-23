#!/usr/bin/env node

/**
 * mySubs KV -> D1 数据迁移脚本
 *
 * 用法:
 *   node scripts/migrate.js --url=https://your-worker.workers.dev --token=YOUR_ADMIN_TOKEN
 *
 * 说明:
 *   1. 部署带有 D1 绑定的 Worker 后运行此脚本；
 *   2. 脚本将登录后台并触发从 KV 到 D1 的一键数据同步；
 *   3. 迁移完成后可安全删除本脚本。
 */

import readline from 'readline'

function parseArgs() {
    const args = process.argv.slice(2)
    const params = {}
    for (const arg of args) {
        if (arg.startsWith('--')) {
            const [k, v] = arg.slice(2).split('=')
            params[k] = v
        }
    }
    return params
}

function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    return new Promise(resolve => {
        rl.question(question, ans => {
            rl.close()
            resolve(ans.trim())
        })
    })
}

async function run() {
    console.log('====================================================')
    console.log('       mySubs KV -> D1 数据库一键迁移工具           ')
    console.log('====================================================\n')

    const params = parseArgs()
    let workerUrl = params.url || process.env.WORKER_URL
    let adminToken = params.token || process.env.ADMIN_TOKEN
    let secureEntrance = params.gate || process.env.SECURE_ENTRANCE || ''

    if (!workerUrl) {
        workerUrl = await prompt('请输入你的 Worker 完整地址 (如 https://my-subs.workers.dev): ')
    }
    if (!adminToken) {
        adminToken = await prompt('请输入你的 ADMIN_TOKEN: ')
    }

    if (!workerUrl || !adminToken) {
        console.error('❌ 错误: Worker URL 与 ADMIN_TOKEN 不能为空')
        process.exit(1)
    }

    // 格式化 URL
    workerUrl = workerUrl.replace(/\/+$/, '')
    if (secureEntrance) {
        secureEntrance = secureEntrance.startsWith('/') ? secureEntrance : `/${secureEntrance}`
        secureEntrance = secureEntrance.replace(/\/+$/, '')
    }

    const baseUrl = `${workerUrl}${secureEntrance}`

    console.log(`\n⏳ 正在连接 Worker: ${baseUrl} ...`)

    try {
        // 1. 登录获取 Cookie
        const loginRes = await fetch(`${baseUrl}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: adminToken })
        })

        if (!loginRes.ok) {
            const errData = await loginRes.json().catch(() => ({}))
            throw new Error(`登录失败 (${loginRes.status}): ${errData.error || 'Token 不正确'}`)
        }

        const cookieHeader = loginRes.headers.get('set-cookie')
        if (!cookieHeader) {
            throw new Error('未获取到有效 Session Cookie')
        }

        // 提取 auth_session
        const sessionCookie = cookieHeader.split(';')[0]
        console.log('✅ 登录成功，已建立管理会话')

        // 2. 检查迁移状态
        console.log('🔍 正在检测 KV 与 D1 状态...')
        const statusRes = await fetch(`${baseUrl}/api/migration-status`, {
            headers: { Cookie: sessionCookie }
        })
        const statusData = await statusRes.json().catch(() => ({}))

        console.log(`- KV 是否存在数据: ${statusData.kvHasData ? '是' : '否'}`)
        console.log(`- D1 当前 Profile 数量: ${statusData.d1ProfilesCount ?? 0}`)

        if (!statusData.canMigrate) {
            console.log('\n⚠️ 提示: D1 中已存在配置或 KV 无数据。')
            const continueAns = await prompt('是否仍然强制执行迁移并覆盖 D1? (y/N): ')
            if (continueAns.toLowerCase() !== 'y') {
                console.log('已取消迁移。')
                process.exit(0)
            }
        }

        // 3. 执行迁移
        console.log('\n🚀 开始执行 KV -> D1 数据迁移...')
        const migrateRes = await fetch(`${baseUrl}/api/migrate-kv-to-d1`, {
            method: 'POST',
            headers: { Cookie: sessionCookie }
        })

        const migrateData = await migrateRes.json().catch(() => ({}))

        if (migrateData.success) {
            console.log('\n🎉 迁移成功！')
            console.log('----------------------------------------------------')
            console.log(`- Base YAML 迁移: ${migrateData.report?.baseYamlMigrated ? '✅ 成功' : '⚪ 无需迁移 (保留默认)'}`)
            console.log(`- Providers 订阅源迁移: ${migrateData.report?.providersCount || 0} 个`)
            console.log(`- Profiles 订阅配置迁移: ${migrateData.report?.profilesCount || 0} 个`)
            if (migrateData.report?.details?.length) {
                console.log('\n详细记录:')
                migrateData.report.details.forEach(d => console.log(`  • ${d}`))
            }
            console.log('----------------------------------------------------')
            console.log('🌟 现有 KV 数据已完整导入 D1 数据库！')
        } else {
            console.error(`❌ 迁移失败: ${migrateData.error}`)
        }
    } catch (err) {
        console.error(`\n❌ 执行异常: ${err.message}`)
        process.exit(1)
    }
}

run()
