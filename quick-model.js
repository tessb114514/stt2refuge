export function pageItems(items, page, size = 24) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(pages, Math.max(1, page));
    return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
}

export function formatLastUsed(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '尚未使用';
    return new Date(time).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function randomPersona(avatars, random = Math.random) {
    return avatars.length ? avatars[Math.min(avatars.length - 1, Math.floor(random() * avatars.length))] : undefined;
}

export function randomCharacter(cards, previousAvatar, random = Math.random) {
    const available = cards.filter(card => card.avatar);
    const pool = available.length > 1 ? available.filter(card => card.avatar !== previousAvatar) : available;
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : undefined;
}
