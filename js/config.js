// URL Web App của Google Apps Script sau khi re-deploy
const API_URL = "https://script.google.com/macros/s/AKfycbyUMT-Rq85WCqBVwLsfNu4XMEITG97lOrdS7VjXi6J-NOtWih021nolsVzQFozI0k4Rdw/exec"; 

// Google Client ID từ Backend Config
const CLIENT_ID = "457034906414-kk5rglsgac2krun66bprec56v0i3c2n2.apps.googleusercontent.com";

// Biến lưu trữ trạng thái dữ liệu trên Frontend
let currentToken = localStorage.getItem('google_id_token') || null;
let userEmail = null;
let globalData = null; // Chứa danh sách thẻ, danh mục, merchant lấy từ Backend
let currentMode = 'card'; // 'card' hoặc 'cash'
