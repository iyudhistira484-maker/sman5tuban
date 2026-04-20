MPLS AI Chat — File Bundle
===========================

1. mpls-ai-chat.js
   Letakkan di folder yang sama dengan halaman absensi.
   Tambahkan di HTML sebelum </body>:
       <script src="mpls-ai-chat.js"></script>

2. ai-chat-edge-function.ts
   Sudah ter-deploy di Lovable Cloud (endpoint:
   https://yazmejgjayocgoionvan.supabase.co/functions/v1/ai-chat).
   File ini hanya untuk referensi.

Fitur:
- Tombol floating kanan-bawah (gradient ungu-biru, pulse)
- Reminder "Jangan lupa absen ya!!" di atas tombol (bisa di-X)
- Modal AI chat dark glassmorphism, streaming Gemini
- Tanpa emoji sama sekali pada UI maupun jawaban AI
