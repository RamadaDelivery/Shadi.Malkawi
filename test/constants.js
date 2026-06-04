// ============================================================
// constants.js — جواهر | ثوابت النظام
// ============================================================

export const USERS = {
    admin:    { pass: '2026', role: 'Admin',    name: 'المدير العام' },
    basel:    { pass: '2026', role: 'Admin',    name: 'باسل'          },
    user:     { pass: '1234', role: 'User',     name: 'موظف إدخال'   },
    delivery: { pass: 'del',  role: 'Delivery', name: 'عامل التوصيل' }
};

export const STATUS_AR = {
    new:       'جديدة',
    process:   'قيد التحضير',
    done:      'جاهزة',
    delivered: 'مسلمة',
    postponed: 'مؤجل',
    canceled:  'ملغي'
};

export const STATUS_ICON = {
    new:       'fas fa-star',
    process:   'fas fa-cog',
    done:      'fas fa-box',
    delivered: 'fas fa-check-double',
    postponed: 'fas fa-clock',
    canceled:  'fas fa-times-circle'
};

export const STATUS_COLORS = {
    new:       '#C9A84C',
    process:   '#1A3A6B',
    done:      '#1A6B4A',
    delivered: '#4A1A6B',
    postponed: '#8B4A1A',
    canceled:  '#8B1A3A'
};

export const GOVERNORATES = [
    'العاصمة (عمّان)', 'إربد', 'الزرقاء', 'المفرق', 'البلقاء',
    'الكرك', 'الطفيلة', 'معان', 'العقبة', 'جرش', 'عجلون', 'مادبا'
];

export const RETURN_REASONS = [
    'مقاس غير مناسب',
    'منتج تالف',
    'لم يعجب الزبون',
    'طلب خاطئ',
    'رفض الاستلام',
    'أخرى'
];

export const COLORS_AR = [
    { name: 'متعدد الألوان', hex: 'linear-gradient(135deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff)', border: '#888', rainbow: true },
    { name: 'أبيض',       hex: '#FFFFFF', border: '#ddd'     },
    { name: 'أسود',       hex: '#1A1A1A', border: '#1A1A1A'  },
    { name: 'رمادي',      hex: '#808080', border: '#808080'  },
    { name: 'بيج',        hex: '#D4B896', border: '#c4a07a'  },
    { name: 'بني',        hex: '#8B5C2A', border: '#8B5C2A'  },
    { name: 'أحمر',       hex: '#D32F2F', border: '#D32F2F'  },
    { name: 'وردي',       hex: '#E91E8C', border: '#E91E8C'  },
    { name: 'برتقالي',    hex: '#FF6B00', border: '#FF6B00'  },
    { name: 'أصفر',       hex: '#FDD835', border: '#c8a800'  },
    { name: 'أخضر',       hex: '#2E7D32', border: '#2E7D32'  },
    { name: 'أخضر فاتح',  hex: '#76C442', border: '#5aab25'  },
    { name: 'أزرق',       hex: '#1565C0', border: '#1565C0'  },
    { name: 'سماوي',      hex: '#29B6F6', border: '#0288d1'  },
    { name: 'نيلي',       hex: '#283593', border: '#283593'  },
    { name: 'بنفسجي',     hex: '#7B1FA2', border: '#7B1FA2'  },
    { name: 'ذهبي',       hex: '#C9A84C', border: '#9A7A2E'  },
    { name: 'فضي',        hex: '#B0BEC5', border: '#78909C'  },
    { name: 'كحلي',       hex: '#1A237E', border: '#1A237E'  }
];

export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

export const STOCK_ALERT_THRESHOLD = 5;

export const FIREBASE_PATHS = {
    orders:    'jawaher_orders',
    logs:      'jawaher_logs',
    warehouse: 'jawaher_warehouse',
    returns:   'jawaher_returns',
    purchases: 'jawaher_purchases',
    defPages:  'jawaher_def/pages',
    defUsers:  'jawaher_def/entryUsers'
};
