// 浏览器探测：环境变量优先、不存在的路径要被过滤掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBrowser, findBrowsers } from '../../src/core/runtime/browser.ts'

function withFakeChrome() {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-browser-'))
  const exe = join(dir, process.platform === 'win32' ? 'chrome.exe' : 'chrome')
  writeFileSync(exe, '', 'utf8')
  return { dir, exe }
}

test('AURABOT_BROWSER 指向真实文件时排在最前面', () => {
  const { dir, exe } = withFakeChrome()
  const old = process.env.AURABOT_BROWSER
  process.env.AURABOT_BROWSER = exe
  try {
    const list = findBrowsers(true)
    assert.equal(list[0].path, exe)
    assert.equal(list[0].source, 'env:AURABOT_BROWSER')
    assert.equal(findBrowser(true), exe)
  } finally {
    if (old === undefined) delete process.env.AURABOT_BROWSER
    else process.env.AURABOT_BROWSER = old
    rmSync(dir, { recursive: true, force: true })
  }
})

test('环境变量指向不存在的文件：忽略，不发脾气', () => {
  const old = process.env.AURABOT_BROWSER
  process.env.AURABOT_BROWSER = join(tmpdir(), 'aurabot-not-a-real-chrome.exe')
  try {
    const list = findBrowsers(true)
    assert.equal(list.some((item) => item.path === process.env.AURABOT_BROWSER), false)
  } finally {
    if (old === undefined) delete process.env.AURABOT_BROWSER
    else process.env.AURABOT_BROWSER = old
  }
})

test('同一个路径不会重复出现', () => {
  const { dir, exe } = withFakeChrome()
  const old = [process.env.AURABOT_BROWSER, process.env.CHROME_PATH]
  process.env.AURABOT_BROWSER = exe
  process.env.CHROME_PATH = exe
  try {
    const list = findBrowsers(true).filter((item) => item.path === exe)
    assert.equal(list.length, 1)
  } finally {
    process.env.AURABOT_BROWSER = old[0] ?? ''
    if (old[0] === undefined) delete process.env.AURABOT_BROWSER
    if (old[1] === undefined) delete process.env.CHROME_PATH
    else process.env.CHROME_PATH = old[1]
    rmSync(dir, { recursive: true, force: true })
  }
})
