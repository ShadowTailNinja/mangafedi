// MangaFedi – public/reader.js
// Vanilla JS, no dependencies. Reads window.READER_DATA.
;(function () {
  'use strict'

  const data = window.READER_DATA
  if (!data || !data.pages || data.pages.length === 0) {
    document.getElementById('reader-pages').innerHTML = '<p>No pages available.</p>'
    return
  }

  const pages = data.pages
  const container = document.getElementById('reader-pages')
  const indicator = document.getElementById('page-indicator')
  const prevBtn = document.getElementById('prev-page')
  const nextBtn = document.getElementById('next-page')
  const toggleBtn = document.getElementById('toggle-mode')

  let currentPage = 0
  let stripMode = data.readingDirection === 'ltr'
  let progressTimer = null
  const isMobile = () => window.innerWidth < 768

  // ─── Image creation ───────────────────────────────────────────────────────

  function createImg(page) {
    const img = document.createElement('img')
    img.src = isMobile() ? page.mobileUrl : page.fullUrl
    img.alt = 'Page ' + page.pageNumber
    img.loading = 'lazy'
    if (page.width && page.height) {
      img.width = page.width
      img.height = page.height
    }
    if (page.blurhash) {
      img.style.background = '#888'  // Simplified placeholder
    }
    return img
  }

  // ─── Strip mode (long strip – all pages visible) ──────────────────────────

  function renderStrip() {
    container.innerHTML = ''
    pages.forEach(function (page) {
      const img = createImg(page)
      container.appendChild(img)
    })
    if (prevBtn) prevBtn.style.display = 'none'
    if (nextBtn) nextBtn.style.display = 'none'
    if (indicator) indicator.textContent = pages.length + ' pages'
    prefetch(0)
  }

  // ─── Paginated mode ───────────────────────────────────────────────────────

  function renderPage(idx) {
    const page = pages[idx]
    if (!page) return
    container.innerHTML = ''
    const img = createImg(page)
    container.appendChild(img)
    currentPage = idx
    if (indicator) indicator.textContent = (idx + 1) + ' / ' + pages.length
    prefetch(idx + 1)
    prefetch(idx + 2)
    scheduleProgress(idx)
  }

  function prevPage() {
    if (data.readingDirection === 'rtl') {
      if (currentPage < pages.length - 1) renderPage(currentPage + 1)
    } else {
      if (currentPage > 0) renderPage(currentPage - 1)
    }
  }

  function nextPage() {
    if (data.readingDirection === 'rtl') {
      if (currentPage > 0) renderPage(currentPage - 1)
    } else {
      if (currentPage < pages.length - 1) renderPage(currentPage + 1)
    }
  }

  // ─── Prefetch ─────────────────────────────────────────────────────────────

  function prefetch(idx) {
    const page = pages[idx]
    if (!page) return
    const img = new Image()
    img.src = isMobile() ? page.mobileUrl : page.fullUrl
  }

  // ─── Progress saving ──────────────────────────────────────────────────────

  function scheduleProgress(idx) {
    if (progressTimer) clearTimeout(progressTimer)
    progressTimer = setTimeout(function () {
      const page = pages[idx]
      if (!page) return
      fetch(data.progressUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ chapterId: data.chapterId, pageNumber: page.pageNumber })
      }).catch(function () {})
    }, 3000)
  }

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    if (stripMode) return
    if (e.key === 'ArrowRight') nextPage()
    if (e.key === 'ArrowLeft') prevPage()
  })

  // ─── Touch/swipe ──────────────────────────────────────────────────────────

  let touchStartX = 0
  document.addEventListener('touchstart', function (e) {
    touchStartX = e.changedTouches[0].clientX
  }, { passive: true })

  document.addEventListener('touchend', function (e) {
    if (stripMode) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(dx) > 50) {
      if (dx < 0) nextPage()
      else prevPage()
    }
  }, { passive: true })

  // ─── Button handlers ──────────────────────────────────────────────────────

  if (prevBtn) prevBtn.addEventListener('click', prevPage)
  if (nextBtn) nextBtn.addEventListener('click', nextPage)

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      stripMode = !stripMode
      toggleBtn.textContent = stripMode ? 'Paginate' : 'Strip'
      if (stripMode) {
        renderStrip()
      } else {
        renderPage(currentPage)
      }
    })
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  if (stripMode) {
    renderStrip()
    if (toggleBtn) toggleBtn.textContent = 'Paginate'
  } else {
    renderPage(0)
    if (toggleBtn) toggleBtn.textContent = 'Strip'
  }

})()
