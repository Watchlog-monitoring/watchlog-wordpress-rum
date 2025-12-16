(function () {
  'use strict'

  if (typeof window === 'undefined') return
  if (window.WatchlogRUMWP) return

  // ===== Internal state =====
  let buffer = []
  let meta = {}
  let flushTimer
  let sessionStartTime
  let lastPageViewPath = null
  let _recentErrors = new Set()
  let _seq = 0
  let _breadcrumbs = []
  let _maxBreadcrumbs = 100
  let _sessionInfo = null
  let _sessionResumed = false
  let _sessionTimeoutMs = 0
  let _sessionPersistenceEnabled = false
  let _sessionStorageKey = null

  // feature flags / config
  let _config = {
    app: '',
    apiKey: '',
    endpoint: '',
    environment: 'prod',
    release: null,
    debug: false,
    flushInterval: 10000,
    sampleRate: 1.0,
    networkSampleRate: 0.1,
    interactionSampleRate: 0.1,
    enableWebVitals: true,
    autoTrackInitialView: true,
    captureLongTasks: true,
    captureFetch: true,
    captureXHR: true,
    captureUserInteractions: false,
    captureBreadcrumbs: true,
    maxBreadcrumbs: 100,
    routeHints: [],
    normalizedPath: null,
    beforeSend: (ev) => ev,
    sessionTimeoutMinutes: 30
  }
  let _sessionDropped = false
  let _listenersInstalled = false
  let _fetchPatched = false
  let _xhrPatched = false
  let _resObserver = null
  let _ltObserver = null
  let _paintObserver = null
  let _interactionListeners = []
  let _initialPathname = '/'

  // ===== Helpers =====
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  function safeWin () { try { return typeof window !== 'undefined' ? window : null } catch { return null } }

  function computeNormalizedPath (pathname) {
    const w = safeWin()
    const hints = Array.isArray(_config.routeHints) ? _config.routeHints : []
    const path = pathname || (w?.location?.pathname ?? '/')
    if (!path) return '/'

    const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '')
    for (const hint of hints) {
      if (!hint || !hint.regex) continue
      try {
        const regex = new RegExp(hint.regex)
        if (regex.test(trimmed)) {
          const pattern = hint.pattern || '/'
          return pattern.startsWith('/') ? pattern : `/${pattern}`
        }
      } catch (err) {
        if (_config.debug) console.warn('[Watchlog RUM][wordpress] invalid route hint regex', hint.regex, err)
      }
    }

    // Heuristic fallback: replace numeric segments with IDs and keep others
    const segments = trimmed.split('/').filter(Boolean)
    if (!segments.length) return '/'

    const normalized = []
    segments.forEach((segment, index) => {
      let value = segment
      const prev = normalized[index - 1]
      if (/^[0-9]{4}$/.test(segment)) {
        value = ':year'
      } else if (/^(0?[1-9]|1[0-2])$/.test(segment) && prev === ':year') {
        value = ':month'
      } else if (/^(0?[1-9]|[12][0-9]|3[01])$/.test(segment) && prev === ':month') {
        value = ':day'
      } else if (/^[0-9]+$/.test(segment)) {
        value = ':id'
      } else if (index > 0 && ['category', 'tag', 'author', 'archives', 'topics', 'topic', 'product', 'products', 'blog'].includes(segments[index - 1])) {
        value = ':slug'
      }
      normalized.push(value)
    })

    return '/' + normalized.join('/')
  }

  const curPath = () => (safeWin()?.location?.pathname || '/')

  // ===== Session helpers =====
  const createSessionId = () => 'sess-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36)

  const getSessionStorageKey = (appName) => {
    const base = (appName || 'default').toString().toLowerCase()
    const slug = base.replace(/[^a-z0-9_-]/g, '')
    return `watchlog_rum_session_${slug || 'default'}`
  }

  function readPersistedSession (key) {
    if (!key) return null
    const w = safeWin()
    try {
      if (!w || !w.localStorage) return null
      const raw = w.localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  function persistSessionState () {
    if (!_sessionPersistenceEnabled || !_sessionStorageKey || !_sessionInfo) return
    const w = safeWin()
    if (!w || !w.localStorage) return
    try {
      w.localStorage.setItem(_sessionStorageKey, JSON.stringify(_sessionInfo))
    } catch {
      /* ignore */
    }
  }

  function touchSessionActivity () {
    if (!_sessionPersistenceEnabled || !_sessionInfo) return
    _sessionInfo.lastSeen = Date.now()
    persistSessionState()
  }

  function hydrateSessionInfo (appName) {
    const now = Date.now()
    _sessionInfo = null
    _sessionResumed = false
    _sessionStorageKey = _sessionPersistenceEnabled ? getSessionStorageKey(appName) : null

    if (_sessionPersistenceEnabled && _sessionStorageKey) {
      const stored = readPersistedSession(_sessionStorageKey)
      if (stored && stored.id) {
        const lastSeen = stored.lastSeen || stored.startedAt || now
        if (_sessionTimeoutMs === 0 || now - lastSeen < _sessionTimeoutMs) {
          _sessionInfo = {
            id: stored.id,
            startedAt: stored.startedAt || now,
            lastSeen: now
          }
          _sessionResumed = true
        }
      }
    }

    if (!_sessionInfo) {
      _sessionInfo = {
        id: createSessionId(),
        startedAt: now,
        lastSeen: now
      }
      _sessionResumed = false
    }

    sessionStartTime = _sessionInfo.startedAt
    persistSessionState()
    return _sessionInfo
  }

  // ===== Enhanced Context Collection =====
  function collectDeviceInfo () {
    const w = safeWin()
    if (!w) return {}

    const nav = w.navigator || {}
    const screen = w.screen || {}
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection || null
    const memory = nav.deviceMemory || null
    const hardwareConcurrency = nav.hardwareConcurrency || null

    const ua = nav.userAgent || ''
    const browser = parseBrowser(ua)
    const os = parseOS(ua)

    const viewport = {
      width: w.innerWidth || screen.width || 0,
      height: w.innerHeight || screen.height || 0,
      devicePixelRatio: w.devicePixelRatio || 1
    }

    const screenInfo = {
      width: screen.width || 0,
      height: screen.height || 0,
      availWidth: screen.availWidth || 0,
      availHeight: screen.availHeight || 0,
      colorDepth: screen.colorDepth || 0,
      pixelDepth: screen.pixelDepth || 0
    }

    const connectionInfo = connection ? {
      effectiveType: connection.effectiveType || null,
      downlink: connection.downlink || null,
      rtt: connection.rtt || null,
      saveData: connection.saveData || false
    } : null

    const memoryInfo = memory ? {
      deviceMemory: memory,
      hardwareConcurrency
    } : null

    const colorScheme = w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    return {
      userAgent: ua,
      language: nav.language || null,
      languages: nav.languages || [],
      platform: nav.platform || null,
      cookieEnabled: nav.cookieEnabled || false,
      onLine: nav.onLine !== undefined ? nav.onLine : true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
      viewport,
      screen: screenInfo,
      connection: connectionInfo,
      memory: memoryInfo,
      browser,
      os,
      colorScheme
    }
  }

  function parseBrowser (ua) {
    if (!ua) return { name: 'unknown', version: null }
    const uaLower = ua.toLowerCase()
    if (uaLower.includes('chrome') && !uaLower.includes('edg')) {
      const match = ua.match(/Chrome\/(\d+)/)
      return { name: 'Chrome', version: match ? match[1] : null }
    }
    if (uaLower.includes('firefox')) {
      const match = ua.match(/Firefox\/(\d+)/)
      return { name: 'Firefox', version: match ? match[1] : null }
    }
    if (uaLower.includes('safari') && !uaLower.includes('chrome')) {
      const match = ua.match(/Version\/(\d+)/)
      return { name: 'Safari', version: match ? match[1] : null }
    }
    if (uaLower.includes('edg')) {
      const match = ua.match(/Edg\/(\d+)/)
      return { name: 'Edge', version: match ? match[1] : null }
    }
    return { name: 'unknown', version: null }
  }

  function parseOS (ua) {
    if (!ua) return { name: 'unknown', version: null }
    const uaLower = ua.toLowerCase()
    if (uaLower.includes('windows')) {
      const match = ua.match(/Windows NT (\d+\.\d+)/)
      return { name: 'Windows', version: match ? match[1] : null }
    }
    if (uaLower.includes('mac os') || uaLower.includes('macos')) {
      const match = ua.match(/Mac OS X (\d+[._]\d+)/)
      return { name: 'macOS', version: match ? match[1].replace('_', '.') : null }
    }
    if (uaLower.includes('linux')) {
      return { name: 'Linux', version: null }
    }
    if (uaLower.includes('android')) {
      const match = ua.match(/Android (\d+\.\d+)/)
      return { name: 'Android', version: match ? match[1] : null }
    }
    if (uaLower.includes('iphone') || uaLower.includes('ipad')) {
      const match = ua.match(/OS (\d+[._]\d+)/)
      return { name: 'iOS', version: match ? match[1].replace('_', '.') : null }
    }
    return { name: 'unknown', version: null }
  }

  // ===== Breadcrumbs =====
  function addBreadcrumb (category, message, level = 'info', data = null) {
    if (!_config.captureBreadcrumbs) return
    if (_breadcrumbs.length >= _maxBreadcrumbs) {
      _breadcrumbs.shift()
    }
    _breadcrumbs.push({
      category,
      message,
      level,
      data,
      timestamp: Date.now()
    })
  }

  // ===== Context & Envelope =====
  function buildContext (path, normalizedPath) {
    const w = safeWin()
    const deviceInfo = collectDeviceInfo()
    return {
      apiKey: meta.apiKey,
      app: meta.app,
      sessionId: meta.sessionId,
      deviceId: meta.deviceId ?? null,
      environment: meta.environment ?? null,
      release: meta.release ?? null,
      page: {
        url: w?.location?.href || null,
        path,
        normalizedPath,
        referrer: (typeof document !== 'undefined' ? document.referrer : '') || null,
        title: (typeof document !== 'undefined' ? document.title : '') || null
      },
      client: deviceInfo,
      breadcrumbs: _config.captureBreadcrumbs ? _breadcrumbs.slice(-20) : []
    }
  }

  function makeEnvelope (type, path, normalizedPath, data) {
    return {
      type,
      ts: Date.now(),
      seq: ++_seq,
      context: buildContext(path, normalizedPath),
      data
    }
  }

  // ===== Buffering =====
  function pushBuffered (env) {
    const final = typeof _config.beforeSend === 'function' ? _config.beforeSend(env) : env
    if (final === null) return
    buffer.push(final)
    if (WatchlogRUM.debug) console.log('[Watchlog RUM][wordpress] buffered:', final)
    if (buffer.length >= 50) flush()
  }

  function bufferEvent (event) {
    if (_sessionDropped) return
    const { type, path, normalizedPath, ...rest } = event

    if (type === 'error') {
      const key = `${rest.event || 'err'}:${rest.label || ''}:${normalizedPath || ''}`
      if (_recentErrors.has(key)) return
      _recentErrors.add(key)
      setTimeout(() => _recentErrors.delete(key), 5000)
    }

    let data
    switch (type) {
      case 'page_view':
        data = { name: 'page_view', navType: rest?.navType || 'navigate' }
        break
      case 'session_start':
        data = { name: 'session_start', referrer: rest?.referrer || null }
        break
      case 'session_end':
        data = { name: 'session_end', duration: rest?.duration ?? null }
        break
      case 'performance':
        data = { name: 'performance', metrics: rest?.metrics || {}, navigation: rest?.navigation || null, paint: rest?.paint || null }
        break
      case 'custom':
        data = { name: rest.metric, value: rest.value ?? 1, extra: rest.extra ?? null }
        break
      case 'error':
        data = {
          name: rest.event || 'error',
          message: rest.label || 'error',
          stack: rest.stack || null,
          source: rest.source || null,
          filename: rest.filename || null,
          lineno: rest.lineno || null,
          colno: rest.colno || null,
          component: rest.component || null,
          props: rest.props || null
        }
        break
      case 'network':
        data = {
          method: rest.method,
          url: rest.url,
          status: rest.status,
          ok: rest.ok,
          duration: rest.duration,
          requestSize: rest.requestSize ?? null,
          responseSize: rest.responseSize ?? null,
          transferSize: rest.transferSize ?? null,
          encodedBodySize: rest.encodedBodySize ?? null,
          decodedBodySize: rest.decodedBodySize ?? null,
          timing: rest.timing || null
        }
        break
      case 'resource':
        data = {
          name: rest.name,
          initiator: rest.initiator,
          duration: rest.duration,
          transferSize: rest.transferSize ?? null,
          encodedBodySize: rest.encodedBodySize ?? null,
          decodedBodySize: rest.decodedBodySize ?? null,
          renderBlockingStatus: rest.renderBlockingStatus || null
        }
        break
      case 'longtask':
        data = {
          duration: rest.duration,
          startTime: rest.startTime || null
        }
        break
      case 'web_vital':
        data = {
          name: rest.name,
          value: rest.value,
          rating: rest.rating || null,
          id: rest.id || null,
          delta: rest.delta || null
        }
        break
      case 'interaction':
        data = {
          type: rest.interactionType,
          target: rest.target || null,
          value: rest.value || null
        }
        break
      default:
        data = { ...rest }
    }

    const env = makeEnvelope(type, path, normalizedPath, data)
    pushBuffered(env)
    touchSessionActivity()
  }

  // ===== Enhanced Performance Capture =====
  function capturePerformance (pathname, normalizedPath) {
    const w = safeWin()
    if (!w || !w.performance) return
    try {
      const nav = w.performance.getEntriesByType?.('navigation')?.[0]
      const paint = w.performance.getEntriesByType?.('paint') || []

      let metrics = {}
      let navigation = null
      let paintMetrics = {}

      if (nav) {
        metrics = {
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          domLoad: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          load: Math.round(nav.loadEventEnd - nav.startTime),
          domInteractive: Math.round(nav.domInteractive - nav.startTime),
          domComplete: Math.round(nav.domComplete - nav.startTime)
        }

        navigation = {
          type: nav.type || 'navigate',
          redirect: Math.round(nav.redirectEnd - nav.redirectStart),
          dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcp: Math.round(nav.connectEnd - nav.connectStart),
          request: Math.round(nav.responseStart - nav.requestStart),
          response: Math.round(nav.responseEnd - nav.responseStart),
          processing: Math.round(nav.domComplete - nav.domInteractive),
          load: Math.round(nav.loadEventEnd - nav.loadEventStart)
        }
      } else {
        const t = w.performance.timing
        if (t && t.navigationStart > 0) {
          metrics = {
            ttfb: t.responseStart - t.requestStart,
            domLoad: t.domContentLoadedEventEnd - t.navigationStart,
            load: t.loadEventEnd - t.navigationStart,
            domInteractive: t.domInteractive - t.navigationStart,
            domComplete: t.domComplete - t.navigationStart
          }

          navigation = {
            type: 'navigate',
            redirect: t.redirectEnd - t.redirectStart,
            dns: t.domainLookupEnd - t.domainLookupStart,
            tcp: t.connectEnd - t.connectStart,
            request: t.responseStart - t.requestStart,
            response: t.responseEnd - t.responseStart,
            processing: t.domComplete - t.domInteractive,
            load: t.loadEventEnd - t.loadEventStart
          }
        }
      }

      paint.forEach(entry => {
        if (entry.name === 'first-paint') {
          paintMetrics.fp = Math.round(entry.startTime)
        } else if (entry.name === 'first-contentful-paint') {
          paintMetrics.fcp = Math.round(entry.startTime)
        }
      })

      if (Object.keys(metrics).length > 0 || Object.keys(paintMetrics).length > 0) {
        bufferEvent({
          type: 'performance',
          metrics,
          navigation,
          paint: Object.keys(paintMetrics).length > 0 ? paintMetrics : null,
          path: pathname,
          normalizedPath
        })
      }
    } catch (err) {
      if (WatchlogRUM.debug) console.warn('[Watchlog RUM] Performance capture error:', err)
    }
  }

  // ===== Global/unload handlers =====
  function handleBeforeUnload () {
    const w = safeWin()
    if (!w) return
    if (!_sessionPersistenceEnabled) {
      const duration = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 1000) : null
      bufferEvent({
        type: 'session_end',
        path: w.location?.pathname || '/',
        normalizedPath: meta.normalizedPath,
        duration
      })
    } else {
      touchSessionActivity()
    }
    flush(true)
    clearInterval(flushTimer)
  }

  function handlePageHide () {
    touchSessionActivity()
    flush(true)
  }

  function onErrorGlobal (e) {
    const w = safeWin()
    addBreadcrumb('error', e?.message || 'Uncaught error', 'error', {
      filename: e?.filename,
      lineno: e?.lineno,
      colno: e?.colno
    })

    bufferEvent({
      type: 'error',
      event: 'window_error',
      label: e?.message || 'error',
      stack: e?.error?.stack,
      source: e?.filename || null,
      filename: e?.filename || null,
      lineno: e?.lineno || null,
      colno: e?.colno || null,
      path: w?.location?.pathname || '/',
      normalizedPath: meta.normalizedPath
    })
  }

  function onRejectionGlobal (e) {
    const w = safeWin()
    const reason = e?.reason
    const message = reason?.message || String(reason || 'Unhandled promise rejection')

    addBreadcrumb('error', message, 'error', {
      reason: String(reason)
    })

    bufferEvent({
      type: 'error',
      event: 'unhandled_promise',
      label: message,
      stack: reason?.stack || null,
      path: w?.location?.pathname || '/',
      normalizedPath: meta.normalizedPath
    })
  }

  // ===== Observers =====
  function observeResources () {
    const w = safeWin()
    if (!w || !('PerformanceObserver' in w) || _resObserver) return
    try {
      _resObserver = new w.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          const it = entry.initiatorType
          if (!it || it === 'fetch' || it === 'xmlhttprequest') return

          bufferEvent({
            type: 'resource',
            name: entry.name,
            initiator: it,
            duration: Math.round(entry.duration),
            transferSize: entry.transferSize || null,
            encodedBodySize: entry.encodedBodySize || null,
            decodedBodySize: entry.decodedBodySize || null,
            renderBlockingStatus: entry.renderBlockingStatus || null,
            path: curPath(),
            normalizedPath: meta.normalizedPath
          })
        })
      })
      _resObserver.observe({ entryTypes: ['resource'] })
    } catch {
      /* ignore */
    }
  }

  function observeLongTasks () {
    const w = safeWin()
    if (!_config.captureLongTasks || !w || !('PerformanceObserver' in w) || _ltObserver) return
    try {
      _ltObserver = new w.PerformanceObserver((list) => {
        list.getEntries().forEach((e) => {
          bufferEvent({
            type: 'longtask',
            duration: Math.round(e.duration),
            startTime: Math.round(e.startTime),
            path: curPath(),
            normalizedPath: meta.normalizedPath
          })
        })
      })
      _ltObserver.observe({ type: 'longtask', buffered: true })
    } catch {
      /* ignore */
    }
  }

  function observePaint () {
    const w = safeWin()
    if (!w || !('PerformanceObserver' in w) || _paintObserver) return
    try {
      _paintObserver = new w.PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.name === 'first-paint' || entry.name === 'first-contentful-paint') {
            bufferEvent({
              type: 'web_vital',
              name: entry.name === 'first-paint' ? 'FP' : 'FCP',
              value: Math.round(entry.startTime),
              path: curPath(),
              normalizedPath: meta.normalizedPath
            })
          }
        })
      })
      _paintObserver.observe({ entryTypes: ['paint'] })
    } catch {
      /* ignore */
    }
  }

  async function installWebVitals () {
    if (!_config.enableWebVitals) return
    try {
      if (typeof webVitals === 'undefined') return
      const { onCLS, onLCP, onINP, onTTFB, onFID } = webVitals
      const wrap = (name) => (metric) => {
        bufferEvent({
          type: 'web_vital',
          name,
          value: Math.round(metric.value),
          rating: metric.rating || null,
          id: metric.id || null,
          delta: metric.delta || null,
          path: curPath(),
          normalizedPath: meta.normalizedPath
        })
      }
      onCLS(wrap('CLS'), { reportAllChanges: true })
      onLCP(wrap('LCP'))
      onINP(wrap('INP'), { reportAllChanges: true })
      onTTFB(wrap('TTFB'))
      if (onFID) onFID(wrap('FID'))
    } catch (err) {
      if (_config.debug) console.warn('[Watchlog RUM] web-vitals unavailable', err)
    }
  }

  // ===== User Interaction Tracking =====
  function installUserInteractions () {
    const w = safeWin()
    if (!_config.captureUserInteractions || !w || !w.document) return

    const sample = () => Math.random() < (_config.interactionSampleRate ?? 0.1)

    const clickHandler = (e) => {
      if (!sample()) return
      const target = e.target
      const tagName = target?.tagName?.toLowerCase() || 'unknown'
      const id = target?.id || null
      const className = target?.className || null

      addBreadcrumb('user', `Clicked ${tagName}`, 'info', {
        tagName,
        id,
        className: typeof className === 'string' ? className : null
      })

      bufferEvent({
        type: 'interaction',
        interactionType: 'click',
        target: tagName,
        value: id || className || null,
        path: curPath(),
        normalizedPath: meta.normalizedPath
      })
    }

    let maxScroll = 0
    const scrollHandler = () => {
      if (!sample()) return
      const scrollTop = w.pageYOffset || w.document?.documentElement?.scrollTop || 0
      const scrollHeight = w.document?.documentElement?.scrollHeight || 0
      const clientHeight = w.innerHeight || 0
      const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop + clientHeight) / scrollHeight * 100) : 0

      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent
        if (scrollPercent % 25 === 0) {
          bufferEvent({
            type: 'interaction',
            interactionType: 'scroll',
            target: 'page',
            value: scrollPercent,
            path: curPath(),
            normalizedPath: meta.normalizedPath
          })
        }
      }
    }

    const submitHandler = (e) => {
      if (!sample()) return
      const form = e.target
      const formId = form?.id || null
      const formAction = form?.action || null

      addBreadcrumb('user', 'Form submitted', 'info', {
        formId,
        formAction
      })

      bufferEvent({
        type: 'interaction',
        interactionType: 'submit',
        target: 'form',
        value: formId || formAction || null,
        path: curPath(),
        normalizedPath: meta.normalizedPath
      })
    }

    w.document.addEventListener('click', clickHandler, true)
    w.addEventListener('scroll', scrollHandler, { passive: true })
    w.document.addEventListener('submit', submitHandler, true)

    _interactionListeners.push(
      () => w.document.removeEventListener('click', clickHandler, true),
      () => w.removeEventListener('scroll', scrollHandler),
      () => w.document.removeEventListener('submit', submitHandler, true)
    )
  }

  // ===== Network (fetch / XHR) =====
  function _sampleNetwork () {
    return Math.random() < (_config.networkSampleRate ?? 0.1)
  }

  function patchFetch () {
    const w = safeWin()
    if (!_config.captureFetch || _fetchPatched || !w || typeof w.fetch !== 'function') return
    const _orig = w.fetch.bind(w)

    w.fetch = async (input, init = {}) => {
      const start = now()
      let method = (init.method || 'GET').toUpperCase()
      let url = typeof input === 'string' ? input : (input?.url || '')
      const send = _sampleNetwork()

      let requestSize = 0
      if (init.body) {
        if (typeof init.body === 'string') requestSize = new Blob([init.body]).size
        else if (init.body instanceof FormData) {
          for (const pair of init.body.entries()) {
            requestSize += JSON.stringify(pair).length
          }
        } else if (init.body instanceof Blob) requestSize = init.body.size
        else if (init.body instanceof ArrayBuffer) requestSize = init.body.byteLength
        else requestSize = JSON.stringify(init.body).length
      }

      try {
        const res = await _orig(input, init)
        const end = now()
        if (send) {
          let transferSize = null
          let encodedBodySize = null
          let decodedBodySize = null
          let timing = null

          try {
            const entries = w.performance.getEntriesByName(res.url || url, 'resource')
            if (entries && entries.length) {
              const last = entries[entries.length - 1]
              transferSize = last.transferSize || null
              encodedBodySize = last.encodedBodySize || null
              decodedBodySize = last.decodedBodySize || null
              if (last.duration) {
                timing = {
                  dns: last.domainLookupEnd - last.domainLookupStart,
                  tcp: last.connectEnd - last.connectStart,
                  request: last.responseStart - last.requestStart,
                  response: last.responseEnd - last.responseStart,
                  total: last.duration
                }
              }
            }
          } catch {
            /* ignore */
          }

          bufferEvent({
            type: 'network',
            method,
            url: res.url || url,
            status: res.status,
            ok: res.ok,
            duration: Math.round(end - start),
            requestSize: requestSize > 0 ? requestSize : null,
            responseSize: decodedBodySize || transferSize || null,
            transferSize,
            encodedBodySize,
            decodedBodySize,
            timing,
            path: curPath(),
            normalizedPath: meta.normalizedPath
          })
        }
        return res
      } catch (err) {
        const end = now()
        if (send) {
          bufferEvent({
            type: 'network',
            method,
            url,
            status: 0,
            ok: false,
            duration: Math.round(end - start),
            requestSize: requestSize > 0 ? requestSize : null,
            responseSize: null,
            transferSize: null,
            path: curPath(),
            normalizedPath: meta.normalizedPath
          })
        }
        throw err
      }
    }

    _fetchPatched = true
  }

  function patchXHR () {
    const w = safeWin()
    if (!_config.captureXHR || _xhrPatched || !w || !w.XMLHttpRequest) return

    const X = w.XMLHttpRequest
    function XR () { const xhr = new X(); return xhr }
    XR.prototype = X.prototype

    const _open = X.prototype.open
    const _send = X.prototype.send

    X.prototype.open = function (method, url, ...rest) {
      this.__wl_method = (method || 'GET').toUpperCase()
      this.__wl_url = String(url || '')
      this.__wl_startTime = now()
      return _open.call(this, method, url, ...rest)
    }

    X.prototype.send = function (body) {
      const start = this.__wl_startTime || now()
      const send = _sampleNetwork()
      const method = this.__wl_method || 'GET'
      const url = this.__wl_url || ''

      let requestSize = 0
      if (body) {
        if (typeof body === 'string') requestSize = new Blob([body]).size
        else if (body instanceof FormData) {
          for (const pair of body.entries()) {
            requestSize += JSON.stringify(pair).length
          }
        } else if (body instanceof Blob) requestSize = body.size
        else if (body instanceof ArrayBuffer) requestSize = body.byteLength
        else requestSize = JSON.stringify(body).length
      }

      const onDone = () => {
        if (!send) return
        const end = now()
        let transferSize = null
        let encodedBodySize = null
        let decodedBodySize = null
        let timing = null

        try {
          const entries = w.performance.getEntriesByName(this.responseURL || url, 'resource')
          if (entries && entries.length) {
            const last = entries[entries.length - 1]
            transferSize = last.transferSize || null
            encodedBodySize = last.encodedBodySize || null
            decodedBodySize = last.decodedBodySize || null

            if (last.duration) {
              timing = {
                dns: last.domainLookupEnd - last.domainLookupStart,
                tcp: last.connectEnd - last.connectStart,
                request: last.responseStart - last.requestStart,
                response: last.responseEnd - last.responseStart,
                total: last.duration
              }
            }
          }
        } catch {
          /* ignore */
        }

        bufferEvent({
          type: 'network',
          method,
          url: this.responseURL || url,
          status: this.status,
          ok: (this.status >= 200 && this.status < 400),
          duration: Math.round(end - start),
          requestSize: requestSize > 0 ? requestSize : null,
          responseSize: decodedBodySize || transferSize || null,
          transferSize,
          encodedBodySize,
          decodedBodySize,
          timing,
          path: curPath(),
          normalizedPath: meta.normalizedPath
        })
      }
      this.addEventListener('load', onDone)
      this.addEventListener('error', onDone)
      this.addEventListener('abort', onDone)
      return _send.call(this, body)
    }

    _xhrPatched = true
  }

  // ===== Transport =====
  function flush (sync = false) {
    if (!buffer.length) return
    const events = buffer.splice(0, buffer.length)
    const w = safeWin()
    if (!w) return

    const wrapper = {
      apiKey: meta.apiKey,
      app: meta.app,
      sdk: 'watchlog-rum-wordpress',
      version: '0.2.0',
      sentAt: Date.now(),
      sessionId: meta.sessionId,
      deviceId: meta.deviceId,
      environment: meta.environment || null,
      release: meta.release || null,
      events
    }
    const body = JSON.stringify(wrapper)

    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Watchlog-Key': meta.apiKey
      }

      if (sync && w.navigator?.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        w.navigator.sendBeacon(WatchlogRUM.endpoint, blob)
      } else if (sync) {
        const xhr = new w.XMLHttpRequest()
        xhr.open('POST', WatchlogRUM.endpoint, false)
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.setRequestHeader('X-Watchlog-Key', meta.apiKey)
        xhr.send(body)
      } else {
        w.fetch(WatchlogRUM.endpoint, { method: 'POST', headers, body, keepalive: true })
          .catch(err => {
            if (WatchlogRUM.debug) console.warn('[Watchlog RUM][wordpress] flush error:', err)
          })
      }
    } catch (err) {
      if (WatchlogRUM.debug) console.warn('[Watchlog RUM][wordpress] flush error:', err)
    }
  }

  // ===== History tracking =====
  function installHistoryListeners () {
    const w = safeWin()
    if (!w || !w.history) return

    const trigger = (navType) => {
      const pathname = w.location?.pathname || '/'
      const normalizedPath = computeNormalizedPath(pathname)
      if (normalizedPath === lastPageViewPath) return
      meta.normalizedPath = normalizedPath
      addBreadcrumb('navigation', `Navigated to ${normalizedPath}`, 'info')
      bufferEvent({ type: 'page_view', path: pathname, normalizedPath, navType })
      capturePerformance(pathname, normalizedPath)
      lastPageViewPath = normalizedPath
    }

    const wrap = (method) => {
      const original = w.history[method]
      if (typeof original !== 'function') return
      w.history[method] = function (...args) {
        const result = original.apply(this, args)
        trigger(method)
        return result
      }
    }

    wrap('pushState')
    wrap('replaceState')
    w.addEventListener('popstate', () => trigger('popstate'))
  }

  // ===== Core SDK =====
  function registerListeners (config) {
    const w = safeWin()
    if (!w) return false

    _config = { ..._config, ...config }
    _maxBreadcrumbs = _config.maxBreadcrumbs || 100
    _initialPathname = w.location?.pathname || '/'

    const {
      apiKey, endpoint, app, debug, flushInterval,
      environment, release, sampleRate, sessionTimeoutMinutes
    } = _config

    if (!apiKey || !endpoint || !app) {
      console.warn('[Watchlog RUM] apiKey, endpoint, and app are required.')
      return false
    }

    const MAX_SAMPLE_RATE = 0.5
    const effectiveSampleRate = (typeof sampleRate === 'number' && sampleRate >= 0 && sampleRate <= 1)
      ? Math.min(sampleRate, MAX_SAMPLE_RATE)
      : MAX_SAMPLE_RATE

    if (sampleRate > MAX_SAMPLE_RATE && WatchlogRUM.debug) {
      console.warn(`[Watchlog RUM] sampleRate (${sampleRate}) exceeds maximum allowed (${MAX_SAMPLE_RATE}). Using ${MAX_SAMPLE_RATE} instead.`)
    }

    _sessionDropped = Math.random() > effectiveSampleRate

    let deviceId = null
    try {
      deviceId = w.localStorage.getItem('watchlog_device_id')
      if (!deviceId) {
        deviceId = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
        w.localStorage.setItem('watchlog_device_id', deviceId)
      }
    } catch {
      /* ignore */
    }

    let normalized = _config.normalizedPath || computeNormalizedPath(_initialPathname)
    const timeoutValue = parseFloat(sessionTimeoutMinutes)
    _sessionTimeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue * 60 * 1000 : 0
    _sessionPersistenceEnabled = _sessionTimeoutMs > 0

    const sessionInfo = hydrateSessionInfo(app)

    meta = {
      apiKey,
      app,
      environment,
      release,
      sessionId: sessionInfo?.id || createSessionId(),
      deviceId,
      normalizedPath: normalized
    }

    WatchlogRUM.debug = !!debug
    WatchlogRUM.endpoint = endpoint

    if (!_listenersInstalled) {
      w.addEventListener('error', onErrorGlobal)
      w.addEventListener('unhandledrejection', onRejectionGlobal)
      w.addEventListener('beforeunload', handleBeforeUnload)
      w.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') handlePageHide() })
      w.addEventListener('pagehide', handlePageHide)
      _listenersInstalled = true
    }

    observeResources()
    observeLongTasks()
    observePaint()
    installWebVitals().catch(() => {})
    patchFetch()
    patchXHR()
    installUserInteractions()
    installHistoryListeners()

    clearInterval(flushTimer)
    flushTimer = setInterval(() => flush(), Number(flushInterval) || 10000)

    if (!_sessionDropped && (_config.autoTrackInitialView !== false)) {
      const pathname = w.location?.pathname || '/'
      normalized = meta.normalizedPath || computeNormalizedPath(pathname)
      const referrer = document.referrer || null

      if (!_sessionResumed) {
        addBreadcrumb('navigation', 'Session started', 'info', { path: normalized })
        bufferEvent({
          type: 'session_start',
          path: pathname,
          normalizedPath: normalized,
          referrer
        })
      } else {
        addBreadcrumb('navigation', 'Session resumed', 'info', { path: normalized })
      }
      bufferEvent({ type: 'page_view', path: pathname, normalizedPath: normalized, navType: 'navigate' })
      capturePerformance(pathname, normalized)
      lastPageViewPath = normalized
    }

    return true
  }

  // ===== Public API =====
  function custom (metric, value = 1, extra = null) {
    if (typeof metric !== 'string' || _sessionDropped) return
    const path = curPath()
    addBreadcrumb('custom', metric, 'info', { value, extra })
    bufferEvent({ type: 'custom', metric, value, extra, path, normalizedPath: meta.normalizedPath })
    flush()
  }

  function captureError (error, context = {}) {
    if (_sessionDropped) return
    const path = curPath()

    let message = 'Unknown error'
    let stack = null

    if (error instanceof Error) {
      message = error.message
      stack = error.stack
    } else if (typeof error === 'string') {
      message = error
    }

    addBreadcrumb('error', message, 'error', {
      stack: stack?.slice(0, 500)
    })

    bufferEvent({
      type: 'error',
      event: 'captured',
      label: message,
      stack,
      component: context.component || null,
      props: context.props || null,
      path,
      normalizedPath: meta.normalizedPath
    })
  }

  const WatchlogRUM = {
    init: registerListeners,
    setNormalizedPath: (p) => (meta.normalizedPath = p),
    bufferEvent,
    custom,
    captureError,
    addBreadcrumb,
    flush,
    computeNormalizedPath,
    debug: false,
    endpoint: ''
  }

  function bootstrap () {
    if (window.WatchlogRUMWPConfig) {
      registerListeners(window.WatchlogRUMWPConfig)
      window.WatchlogRUMWP = WatchlogRUM
    } else if (_config.debug) {
      console.warn('[Watchlog RUM] Missing WatchlogRUMWPConfig')
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bootstrap()
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap)
  }
})()
