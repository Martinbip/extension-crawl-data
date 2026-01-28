# Chrome Extension - Shopify Personalization Image Crawler

## 📦 Cài đặt Extension

### Bước 1: Load Extension vào Chrome

1. Mở Chrome và truy cập: `chrome://extensions/`
2. Bật **Developer mode** (góc trên bên phải)
3. Click **"Load unpacked"**
4. Chọn folder: `/Users/chienminh/.gemini/antigravity/scratch/shopify-image-crawler/chrome-extension`
5. Extension sẽ xuất hiện trong danh sách!

### Bước 2: Pin Extension

1. Click vào icon puzzle 🧩 trên thanh toolbar
2. Tìm **"Shopify Personalization Image Crawler"**
3. Click vào icon pin 📌 để ghim extension

---

## 🚀 Cách sử dụng

### 1. Truy cập trang sản phẩm Shopify

Mở trang sản phẩm có personalization (ví dụ: https://macorner.co/products/...)

### 2. Mở Extension

Click vào icon extension trên toolbar

### 3. Kiểm tra Detection

Extension sẽ tự động kiểm tra xem trang có dùng Customily không:

- ✅ **Customily Detected** → Có thể crawl
- ❌ **Customily Not Found** → Không thể crawl

### 4. Cấu hình Options

- **Skip thumbnails**: Chỉ lấy ảnh chính, bỏ thumbnails
- **Organize by category**: Tổ chức ảnh theo categories

### 5. Start Crawling

Click nút **"Start Crawling"** và đợi!

### 6. Xem kết quả

- Extension sẽ hiển thị:
  - Số categories
  - Tổng số ảnh
  - Số ảnh đã download
- Ảnh sẽ được tự động download vào folder **Downloads/shopify-personalization/**

---

## 📁 Cấu trúc Download

```
Downloads/
└── shopify-personalization/
    ├── Woman's Body Form/
    │   ├── 001_Slim_CrcNpQM50I__slim.png
    │   └── 002_Curvy_ue2KngKJxU__curvy.png
    ├── da nam/
    │   ├── 001_1_Wr7GX8QDlj__151.png
    │   └── ...
    └── Accessories/
        └── ...
```

---

## ✨ Tính năng

- ✅ Tự động detect Customily trên trang
- ✅ Hiển thị status real-time
- ✅ Progress bar khi download
- ✅ Tổ chức ảnh theo category
- ✅ UI đẹp với gradient design
- ✅ Không cần Python hay command line

---

## 🐛 Troubleshooting

### Extension không detect Customily

- Refresh lại trang sản phẩm
- Đảm bảo trang đã load xong hoàn toàn
- Kiểm tra xem trang có thực sự dùng Customily không

### Download bị block

- Chrome có thể hỏi permission cho multiple downloads
- Click **"Allow"** khi Chrome hỏi

### Ảnh không download

- Kiểm tra Chrome downloads settings
- Đảm bảo không bật "Ask where to save each file"

---

## 🔄 Update Extension

Nếu có thay đổi code:

1. Vào `chrome://extensions/`
2. Click nút **reload** ⟳ trên extension card
3. Extension sẽ update với code mới

---

## 📝 Files trong Extension

```
chrome-extension/
├── manifest.json          # Extension config
├── popup.html            # UI popup
├── popup.css             # Styling
├── popup.js              # UI logic
├── content.js            # Page detection
├── background.js         # Crawling logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🎨 Screenshots

Extension popup sẽ hiển thị:

- Page status (Customily detected hay không)
- Product URL
- Options checkboxes
- Start button
- Progress bar khi crawling
- Results với categories và image counts

---

## 💡 Tips

- Extension hoạt động trên **mọi trang web**, nhưng chỉ crawl được nếu detect Customily
- Ảnh được download trực tiếp từ `assets.medzt.com`
- Không cần internet tốc độ cao - extension chỉ fetch JSON config nhỏ
- Có thể crawl nhiều products liên tiếp

---

## 🙏 Credits

Built with ❤️ for Shopify personalization crawling
