const fetch = require('node-fetch');

// جلب رابط الموقع من متغيرات البيئة أو استخدام الرابط الافتراضي على Vercel
const SITE_URL = process.env.SITE_URL || 'https://badges-site.vercel.app';
const API_SECRET = process.env.CRON_SECRET || '';

/**
 * جلب قائمة البادجات من API الموقع الجديد
 */
async function fetchBadges() {
    try {
        const response = await fetch(`${SITE_URL}/api/badges`, {
            headers: {
                'Authorization': `Bearer ${API_SECRET}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.badges || data;
    } catch (error) {
        console.error('Error fetching badges from Vercel site:', error);
        return [];
    }
}

/**
 * البحث عن بادج محدد باسمه
 */
async function getBadgeByName(name) {
    const badges = await fetchBadges();
    if (!Array.isArray(badges)) return null;
    
    const searchName = name.toLowerCase().trim();
    return badges.find(b => 
        (b.name && b.name.toLowerCase() === searchName) || 
        (b.title && b.title.toLowerCase() === searchName)
    );
}

module.exports = {
    fetchBadges,
    getBadgeByName
};
