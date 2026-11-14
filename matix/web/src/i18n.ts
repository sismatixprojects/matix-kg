// MatixBridge web client language: Arabic by default, English on request (the switch on the
// connect and sign-in screens, or ?lang=en). Strings are written in English in the code and
// looked up here; a string with no entry shows in English. {name} placeholders are filled from vars.
export type Lang = "ar" | "en";

const KEY = "matixbridge.lang";

function read(): Lang {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "ar" || q === "en") {
      localStorage.setItem(KEY, q);
      return q;
    }
    return localStorage.getItem(KEY) === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

export const lang: Lang = read();

export function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: the reload below still applies ?lang */
  }
  const u = new URL(location.href);
  u.searchParams.set("lang", l);
  location.replace(u.toString());
}

export function t(en: string, vars: Record<string, string | number> = {}): string {
  const s = (lang === "ar" && AR[en]) || en;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** "1 device" / "3 devices" in English; Arabic uses the count form that reads naturally for each. */
export function devices(n: number): string {
  if (lang === "en") return `${n} device${n === 1 ? "" : "s"}`;
  if (n === 1) return "جهاز واحد";
  if (n === 2) return "جهازين";
  if (n >= 3 && n <= 10) return `${n} أجهزة`;
  return `${n} جهاز`;
}

const AR: Record<string, string> = {
  // connect screen
  "Remote support by Matix": "الدعم الفني عن بُعد من ماتكس",
  "Leave empty to ask the customer to accept": "اتركها فارغة ليُطلب من العميل الموافقة",
  "Your name": "اسمك",
  Connect: "اتصال",
  "Customer's MatixBridge ID": "رقم MatixBridge الخاص بالعميل",
  Password: "كلمة المرور",
  "Ask the customer to read you the ID shown in their MatixBridge app. Without a password, they will be asked to accept the connection.":
    "اطلب من العميل أن يقرأ لك الرقم الظاهر في برنامج MatixBridge لديه. بدون كلمة مرور سيُطلب منه الموافقة على الاتصال.",
  "Shown to the customer as": "يظهر للعميل باسم",
  "Open file transfer only": "فتح نقل الملفات فقط",
  "Enter the customer's ID.": "أدخل رقم العميل.",
  "MatixBridge by Matix · Sismatix Information Systems · ": "MatixBridge من ماتكس · سيسماتكس لنظم المعلومات · ",
  "based on RustDesk (AGPL-3.0)": "مبني على RustDesk (AGPL-3.0)",
  "This browser cannot show remote screens (no WebCodecs). Use Chrome, Edge or Safari 16.4+.":
    "هذا المتصفح لا يستطيع عرض الشاشة البعيدة (لا يدعم WebCodecs). استخدم Chrome أو Edge أو Safari 16.4 أو أحدث.",
  "Sign in with Matix Agents": "تسجيل الدخول بحساب Matix Agents",
  "MatixBridge is for Matix support staff. Sign in with your Matix Agents account to connect to a customer.":
    "MatixBridge مخصص لفريق الدعم الفني في ماتكس. سجّل الدخول بحساب Matix Agents للاتصال بالعميل.",
  "Sign out": "تسجيل الخروج",
  "Signed in as ": "تم تسجيل الدخول باسم ",
  "Ticket #{ticket}: sessions to {id} are logged on it": "التذكرة #{ticket}: جلسات الاتصال بالجهاز {id} تُسجَّل عليها",
  // password prompt and status
  "Log in": "دخول",
  Cancel: "إلغاء",
  "Wrong password": "كلمة المرور غير صحيحة",
  "Password required": "كلمة المرور مطلوبة",
  "Enter the password shown on the customer's computer.": "أدخل كلمة المرور الظاهرة على جهاز العميل.",
  // session toolbar
  "Click to name this device": "اضغط لتسمية هذا الجهاز",
  "Connecting…": "جارٍ الاتصال…",
  "Name for this device (e.g. customer or company):": "اسم هذا الجهاز (مثلاً اسم العميل أو الشركة):",
  "Remote display": "الشاشة البعيدة",
  "Image quality": "جودة الصورة",
  Balanced: "متوازنة",
  "Best quality": "أفضل جودة",
  "Fast (low quality)": "سريعة (جودة منخفضة)",
  Lock: "قفل",
  "Lock the remote screen": "قفل الشاشة البعيدة",
  Refresh: "تحديث",
  "Refresh the picture": "تحديث الصورة",
  "Type text": "كتابة نص",
  "Type a text on the remote computer": "كتابة نص على الجهاز البعيد",
  "Send clipboard": "إرسال الحافظة",
  "Send your clipboard text to the remote computer": "إرسال نص الحافظة لديك إلى الجهاز البعيد",
  View: "طريقة العرض",
  "Whole screen": "الشاشة كاملة",
  "Original size": "الحجم الأصلي",
  Chat: "محادثة",
  "Voice call": "مكالمة صوتية",
  "Talk with the customer (they accept on their screen)": "تحدّث مع العميل (يقبل المكالمة على شاشته)",
  "Calling…": "جارٍ الطلب…",
  "End call": "إنهاء المكالمة",
  "Call ended": "انتهت المكالمة",
  "This browser cannot make voice calls. Use Chrome or Edge.": "هذا المتصفح لا يدعم المكالمات الصوتية. استخدم Chrome أو Edge.",
  "Microphone access was refused. Allow it in the address bar.": "تم رفض الوصول إلى الميكروفون. اسمح به من شريط العنوان.",
  "Calling the customer… They must accept on their screen.": "جارٍ الاتصال بالعميل… يجب أن يقبل المكالمة على شاشته.",
  "Call connected. Use a headset to avoid echo.": "بدأت المكالمة. استخدم سماعة رأس لتجنّب الصدى.",
  "The customer declined the call": "رفض العميل المكالمة",
  "The customer ended the call": "أنهى العميل المكالمة",
  Files: "الملفات",
  Record: "تسجيل",
  "Record this session to a video file": "تسجيل هذه الجلسة في ملف فيديو",
  "Full screen": "ملء الشاشة",
  Disconnect: "قطع الاتصال",
  "More controls": "المزيد من الأدوات",
  "More ▾": "المزيد ▾",
  "Customer allowed: {name}": "سمح العميل: {name}",
  "Customer blocked: {name}": "منع العميل: {name}",
  "Remote clipboard copied to your clipboard": "تم نسخ حافظة الجهاز البعيد إلى حافظتك",
  "Session not logged: {error}": "لم تُسجَّل الجلسة: {error}",
  "Display {n} ({w}×{h})": "الشاشة {n} ({w}×{h})",
  "Connected, waiting for the picture…": "تم الاتصال، في انتظار الصورة…",
  "Message the customer…": "اكتب رسالة للعميل…",
  Send: "إرسال",
  "Customer: {text}": "العميل: {text}",
  Close: "إغلاق",
  "Text to type on the remote computer:": "النص المطلوب كتابته على الجهاز البعيد:",
  "Your clipboard has no text.": "لا يوجد نص في حافظتك.",
  "Clipboard sent. Press Ctrl+V on the remote computer.": "تم إرسال الحافظة. اضغط Ctrl+V على الجهاز البعيد.",
  "The browser blocked clipboard access. Allow it in the address bar.": "منع المتصفح الوصول إلى الحافظة. اسمح به من شريط العنوان.",
  // more menu
  "Sound from the remote computer": "صوت الجهاز البعيد",
  "This browser cannot play remote sound. Use Chrome or Edge.": "هذا المتصفح لا يستطيع تشغيل صوت الجهاز البعيد. استخدم Chrome أو Edge.",
  "Remote sound on": "تم تشغيل الصوت",
  "Remote sound off": "تم إيقاف الصوت",
  "Block the customer's mouse and keyboard": "إيقاف ماوس ولوحة مفاتيح العميل",
  "The customer's mouse and keyboard are blocked": "تم إيقاف ماوس ولوحة مفاتيح العميل",
  "The customer's mouse and keyboard work again": "عاد ماوس ولوحة مفاتيح العميل للعمل",
  "Only Windows computers support this": "متاح لأجهزة Windows فقط",
  "Privacy mode: black out the customer's screen": "وضع الخصوصية: إظلام شاشة العميل",
  "Turning privacy mode on…": "جارٍ تشغيل وضع الخصوصية…",
  "Turning privacy mode off…": "جارٍ إيقاف وضع الخصوصية…",
  "The remote computer does not support privacy mode": "الجهاز البعيد لا يدعم وضع الخصوصية",
  "Request admin rights (UAC)": "طلب صلاحيات المسؤول (UAC)",
  "Asked the customer to allow admin rights. They must click Yes on their screen.": "تم طلب صلاحيات المسؤول من العميل. يجب أن يضغط «نعم» على شاشته.",
  "Only needed on Windows": "مطلوب على Windows فقط",
  "Restart the remote computer": "إعادة تشغيل الجهاز البعيد",
  "Restart the customer's computer now? Unsaved work on it will be lost.": "إعادة تشغيل جهاز العميل الآن؟ سيضيع أي عمل غير محفوظ عليه.",
  "Restart requested. Reconnect once the computer is back and MatixBridge is open.": "تم طلب إعادة التشغيل. أعد الاتصال بعد عودة الجهاز وفتح MatixBridge.",
  "Could not block the customer's input{details}": "تعذّر إيقاف ماوس ولوحة مفاتيح العميل{details}",
  "Could not unblock the customer's input{details}": "تعذّر إعادة تشغيل ماوس ولوحة مفاتيح العميل{details}",
  "Privacy mode on: the customer's screen is black": "وضع الخصوصية يعمل: شاشة العميل مُظلمة",
  "The customer turned privacy mode off": "أوقف العميل وضع الخصوصية",
  "Privacy mode off": "تم إيقاف وضع الخصوصية",
  "Privacy mode is not supported on that computer": "وضع الخصوصية غير مدعوم على هذا الجهاز",
  "The customer's settings do not allow privacy mode": "إعدادات العميل لا تسمح بوضع الخصوصية",
  "Privacy mode failed{details}": "فشل وضع الخصوصية{details}",
  "Admin rights granted. You can now control admin windows.": "تم منح صلاحيات المسؤول. يمكنك الآن التحكم في نوافذ المسؤول.",
  "Admin rights were not granted: {error}": "لم تُمنح صلاحيات المسؤول: {error}",
  "The customer's active window needs admin rights. Use More ▾ › Request admin rights.":
    "النافذة المفتوحة لدى العميل تحتاج صلاحيات المسؤول. استخدم المزيد ▾ › طلب صلاحيات المسؤول.",
  "Recording started. Click Record again to stop and save.": "بدأ التسجيل. اضغط «تسجيل» مرة أخرى للإيقاف والحفظ.",
  Disconnected: "انقطع الاتصال",
  // address book
  "Search name, ID, customer or computer…": "ابحث بالاسم أو الرقم أو العميل أو الجهاز…",
  "Add a device without connecting": "إضافة جهاز بدون اتصال",
  "+ Add": "+ إضافة",
  More: "المزيد",
  "Export to file": "تصدير إلى ملف",
  "Import from file": "استيراد من ملف",
  "Add this browser's devices to the team list": "إضافة أجهزة هذا المتصفح إلى قائمة الفريق",
  "Imported {devices}.": "تم استيراد {devices}.",
  "That file is not a MatixBridge device list.": "هذا الملف ليس قائمة أجهزة MatixBridge.",
  "Every device in this browser is already in the team list.": "كل أجهزة هذا المتصفح موجودة بالفعل في قائمة الفريق.",
  "Add {devices} from this browser to the team list?": "إضافة {devices} من هذا المتصفح إلى قائمة الفريق؟",
  "Added {devices} to the team list.": "تمت إضافة {devices} إلى قائمة الفريق.",
  "Device ID:": "رقم الجهاز:",
  "Name (customer or company):": "الاسم (العميل أو الشركة):",
  "{when} by {agent}": "{when} بواسطة {agent}",
  "not connected yet": "لم يتم الاتصال بعد",
  Unpin: "إلغاء التثبيت",
  "Pin to top (this browser)": "تثبيت في الأعلى (هذا المتصفح)",
  Rename: "إعادة تسمية",
  "Remove from the team list": "حذف من قائمة الفريق",
  Remove: "حذف",
  "File transfer": "نقل الملفات",
  "Name for this device:": "اسم هذا الجهاز:",
  "Remove {name} ({id}) from the team list (for everyone)?": "حذف {name} ({id}) من قائمة الفريق (للجميع)؟",
  "Remove {name} ({id}) from your devices?": "حذف {name} ({id}) من أجهزتك؟",
  "Click to fill the ID": "اضغط لكتابة الرقم",
  "Loading the team list…": "جارٍ تحميل قائمة الفريق…",
  "Devices you connect to appear here, so you can reconnect in one click. Click the device name during a session to label it.":
    "الأجهزة التي تتصل بها تظهر هنا لتعيد الاتصال بضغطة واحدة. اضغط اسم الجهاز أثناء الجلسة لتسميته.",
  "No device matches your search.": "لا يوجد جهاز يطابق البحث.",
  "Shared with your team at {org}. Pins (★) are kept in this browser.": "مشتركة مع فريقك في {org}. التثبيت (★) محفوظ في هذا المتصفح.",
  "Shared with your team. Pins (★) are kept in this browser.": "مشتركة مع فريقك. التثبيت (★) محفوظ في هذا المتصفح.",
  "Saved in this browser only. Use ⋯ › Export to move the list to another computer.": "محفوظة في هذا المتصفح فقط. استخدم ⋯ › تصدير لنقل القائمة إلى جهاز آخر.",
  "Team devices": "أجهزة الفريق",
  "Customer devices": "أجهزة العملاء",
  never: "أبداً",
  "just now": "الآن",
  "{n} min ago": "منذ {n} دقيقة",
  "{n} h ago": "منذ {n} ساعة",
  "{n} days ago": "منذ {n} يوم",
  "1 day ago": "منذ يوم",
  // files
  "Parent folder": "المجلد الأعلى",
  Go: "انتقال",
  "Drop files here or ": "اسحب الملفات هنا أو ",
  "choose files": "اختر ملفات",
  " to upload to this folder": " لرفعها إلى هذا المجلد",
  "Remote files": "ملفات الجهاز البعيد",
  "Opening file transfer…": "جارٍ فتح نقل الملفات…",
  "Wrong password. Password:": "كلمة المرور غير صحيحة. كلمة المرور:",
  "Password for file transfer:": "كلمة المرور لنقل الملفات:",
  "File transfer closed: {reason}": "أُغلق نقل الملفات: {reason}",
  "Loading…": "جارٍ التحميل…",
  "Empty folder": "مجلد فارغ",
  "Download ({size})": "تنزيل ({size})",
  done: "تم",
  failed: "فشل",
  uploaded: "تم الرفع",
  "File transfer is not connected yet.": "نقل الملفات غير متصل بعد.",
  "File transfer closed": "أُغلق نقل الملفات",
  "The remote side did not list the folder": "لم يُرسل الجهاز البعيد محتوى المجلد",
  "No answer from the remote side for {name}": "لا يوجد رد من الجهاز البعيد بخصوص {name}",
  "A file block could not be decompressed": "تعذّر فك ضغط جزء من الملف",
  "File transfer failed": "فشل نقل الملف",
  // connection
  "Cannot open {url}: {error}": "تعذّر فتح {url}: {error}",
  "Timed out connecting to {url}": "انتهت مهلة الاتصال بـ {url}",
  "Failed to connect to {url}": "تعذّر الاتصال بـ {url}",
  "Timed out waiting for the remote side": "انتهت مهلة انتظار الجهاز البعيد",
  "Contacting the ID server…": "جارٍ الاتصال بخادم الأرقام…",
  "Connecting through the relay…": "جارٍ الاتصال عبر خادم الترحيل…",
  "Securing the connection…": "جارٍ تأمين الاتصال…",
  "Waiting for the remote side…": "في انتظار الجهاز البعيد…",
  "Cannot reach the ID server ({error})": "تعذّر الوصول إلى خادم الأرقام ({error})",
  "This ID does not exist. Check the number the customer gave you.": "هذا الرقم غير موجود. تأكد من الرقم الذي أعطاك إياه العميل.",
  "The remote computer is offline.": "الجهاز البعيد غير متصل بالإنترنت.",
  "Server key mismatch: the web client and the server are configured with different keys.": "مفتاح الخادم غير متطابق: إعدادات الصفحة والخادم تستخدم مفاتيح مختلفة.",
  "Server key overuse.": "تم تجاوز حد استخدام مفتاح الخادم.",
  "The ID server refused the connection.": "رفض خادم الأرقام الاتصال.",
  "The ID server returned no relay session.": "لم يُرجع خادم الأرقام جلسة ترحيل.",
  "The ID server closed the connection ({error})": "أغلق خادم الأرقام الاتصال ({error})",
  "The remote computer did not answer. Is the MatixBridge app running?": "الجهاز البعيد لم يرد. هل برنامج MatixBridge يعمل لدى العميل؟",
  "The server did not vouch for the remote computer's key. Refusing an unencrypted session.": "لم يؤكد الخادم مفتاح الجهاز البعيد. تم رفض جلسة غير مشفّرة.",
  "The server's signature on the remote computer's key is invalid (wrong server key?).": "توقيع الخادم على مفتاح الجهاز البعيد غير صالح (مفتاح خادم خاطئ؟).",
  "Handshake failed: unexpected first message from the remote side.": "فشل بدء الاتصال: رسالة غير متوقعة من الجهاز البعيد.",
  "Handshake failed: the remote computer's identity could not be verified.": "فشل بدء الاتصال: تعذّر التحقق من هوية الجهاز البعيد.",
  "Handshake failed: identity mismatch.": "فشل بدء الاتصال: الهوية غير متطابقة.",
  "Waiting for the customer to accept…": "في انتظار موافقة العميل…",
  "The remote computer has no display.": "الجهاز البعيد ليس له شاشة.",
  "Logging in…": "جارٍ الدخول…",
  "Remote control is only available from agents.matix.one (MatixBridge). Sign in there with your Matix Agents account.":
    "التحكم عن بُعد متاح فقط من agents.matix.one (MatixBridge). سجّل الدخول هناك بحساب Matix Agents.",
  "This browser cannot decode {codec} video. Use Chrome or Edge.": "هذا المتصفح لا يستطيع عرض فيديو {codec}. استخدم Chrome أو Edge.",
  "Canvas 2D is not available": "الرسم ثنائي الأبعاد غير متاح في هذا المتصفح",
  // team sign-in
  "Not signed in": "لم يتم تسجيل الدخول",
  "Your sign-in has expired. Please sign in again.": "انتهت صلاحية تسجيل الدخول. سجّل الدخول مرة أخرى.",
  "Request failed ({status})": "فشل الطلب ({status})",
  "Sign-in failed": "فشل تسجيل الدخول",
  "The web client is not configured (config.json is missing the server addresses or key).": "الصفحة غير مُعدّة (ملف config.json لا يحتوي عناوين الخادم أو المفتاح).",
  // remote close reasons sent by the customer's app
  "Connection was refused": "تم رفض الاتصال",
  "Remote desktop is off": "التحكم عن بُعد مغلق على جهاز العميل",
  "Connection closed by the customer": "أغلق العميل الاتصال",
};
