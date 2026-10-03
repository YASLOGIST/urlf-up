/**
 * strings.js — bilingual dictionary for the member console.
 *
 * ── Why a second mechanism next to data-en/data-ar ─────────────────────────
 * The marketing document carries its translations inline (`data-en`/`data-ar`
 * on 180+ nodes) because that copy ships in `index.html`, which is on the
 * critical path either way. The console — dashboard, dialogs, toasts, deal
 * room — is rendered by the *lazy* chunks, so its translations belong in the
 * lazy graph too. This module is imported only by console code, so it never
 * costs the landing page a byte.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 *  - Every user-visible string in console modules comes from here. No module
 *    keeps a private English literal it renders directly.
 *  - `en` and `ar` carry exactly the same key set — enforced by a spec.
 *  - Keys are grouped by owning surface (`nx.` dashboard, `auth.`, `idea.`,
 *    `settings.`, `avatar.`, `chips.`, `cal.`, `deal.`, `match.` engine notes).
 *  - Plurals use `tCount()` + `Intl.PluralRules`, so Arabic gets its real
 *    zero/one/two/few/many/other categories instead of an English-style
 *    "s" appended to a translation.
 *
 * ── Static markup ──────────────────────────────────────────────────────────
 * Modal markup that ships in index.html but is console-owned is translated by
 * KEY rather than by inline copy, to keep the critical-path document small:
 *
 *   <label data-i18n="auth.email">Email</label>
 *   <input data-i18n-placeholder="auth.emailPh" …>
 *   <button data-i18n-aria="nav.settingsAria" …>
 *
 * `applyConsoleTranslations()` resolves those, and re-runs on every
 * `urlife:langchange` once `initConsoleI18n()` has been called.
 */

import { getLanguage } from './i18n.js';
import { renderRichText } from './i18n.js';

/* ─────────────────────────────────────────────────────────────────────────
 * Dictionary
 * ───────────────────────────────────────────────────────────────────────── */

export const STRINGS = {
  en: {
    /* roles & statuses (shared vocabulary) */
    'role.visionary': 'Visionary',
    'role.builder': 'Builder',
    'role.enabler': 'Enabler',
    'role.member': 'Member',
    'status.pending': 'pending',
    'status.acknowledged': 'acknowledged',
    'status.accepted': 'accepted',
    'status.declined': 'declined',
    'status.withdrawn': 'withdrawn',
    'tier.gold': 'Gold',
    'tier.silver': 'Silver',
    'tier.bronze': 'Bronze',

    /* dashboard */
    'nx.score': 'score',
    'nx.confidence': '{value}% confidence',
    'nx.error': 'Something went wrong. Check your connection and try again.',
    'nx.retry': 'Retry',
    'nx.empty.visionary.title': 'No ideas yet.',
    'nx.empty.visionary.sub': 'Submit your first idea — the engine will find your team.',
    'nx.empty.operator.title': 'No open ideas match yet.',
    'nx.empty.operator.sub':
      'Add skills and interests in settings so the engine can rank better opportunities.',
    'nx.anonymous': 'Anonymous member',
    'nx.recommendedMember': 'Recommended member',
    'nx.untitled': 'Untitled',
    'nx.untitledIdea': 'Untitled idea',
    'nx.uncategorised': 'Uncategorised',
    'nx.verified': 'verified',
    'nx.accept': 'Accept',
    'nx.decline': 'Decline',
    'nx.withdraw': 'Withdraw',
    'nx.express': "I'm interested",
    'nx.dealRoom': 'Open Deal Room',
    'nx.readiness': 'Readiness',
    'nx.readinessAria': 'Idea readiness',
    'nx.incomingInterest.zero': 'No incoming interest yet',
    'nx.incomingInterest.one': '{count} incoming interest',
    'nx.incomingInterest.two': '{count} incoming interests',
    'nx.incomingInterest.few': '{count} incoming interests',
    'nx.incomingInterest.many': '{count} incoming interests',
    'nx.incomingInterest.other': '{count} incoming interests',
    'nx.interestedCount.zero': 'No interest yet',
    'nx.interestedCount.one': '{count} interested',
    'nx.interestedCount.two': '{count} interested',
    'nx.interestedCount.few': '{count} interested',
    'nx.interestedCount.many': '{count} interested',
    'nx.interestedCount.other': '{count} interested',
    'nx.noInterestYet': 'No one has raised a hand yet. Recommendations below show who to invite first.',
    'nx.recommendedOperators': 'Recommended operators',
    'nx.recommendedOperatorsAria': 'Recommended operators for {title}',
    'nx.interestAria': 'Interest for {title}',
    'nx.improveRecommendations': 'Add more required skills to improve recommendations.',
    'nx.for': 'For: {title}',
    'nx.spotlight.visionary.title': 'Best operator invitations',
    'nx.spotlight.visionary.sub': 'Ranked from your required skills, industry and operator trust signals.',
    'nx.spotlight.operator.title': 'Recommended next meetings',
    'nx.spotlight.operator.sub': 'Ranked by role fit, skills, industry interests and profile confidence.',
    'nx.header': 'NEXUS — {name}',
    'nx.welcome': 'Welcome',
    'nx.interestBadge.pending': 'Interest pending',
    'nx.interestBadge.acknowledged': 'Interest acknowledged',
    'nx.interestBadge.accepted': 'Interest accepted',
    'nx.interestBadge.declined': 'Interest declined',
    'nx.interestBadge.withdrawn': 'Interest withdrawn',
    'nx.toast.interestSent': 'Interest sent to the visionary.',
    'nx.toast.interestDuplicate': 'You already raised interest in this idea.',
    'nx.toast.interestSendFailed': 'Could not send interest. Please try again.',
    'nx.toast.interestUpdateFailed': 'Could not update interest. Please try again.',
    'nx.toast.dealLocked': 'Closed meeting protocol locked.',
    'nx.toast.interestStatus.pending': 'Interest pending.',
    'nx.toast.interestStatus.acknowledged': 'Interest acknowledged.',
    'nx.toast.interestStatus.accepted': 'Interest accepted.',
    'nx.toast.interestStatus.declined': 'Interest declined.',
    'nx.toast.interestStatus.withdrawn': 'Interest withdrawn.',

    /* matching engine notes (rendered in reason lists) */
    'match.axis.skills': 'Skills',
    'match.axis.industry': 'Industry',
    'match.axis.role': 'Role',
    'match.axis.capital': 'Capital',
    'match.axis.trust': 'Trust',
    'match.axis.data': 'Data',
    'match.tier.Perfect Match': 'Perfect Match',
    'match.tier.Strong Match': 'Strong Match',
    'match.tier.Viable Match': 'Viable Match',
    'match.tier.Weak Match': 'Weak Match',
    'match.tier.Not Recommended': 'Not Recommended',
    'match.skills.ideaEmpty': 'Idea has not declared required skills yet.',
    'match.skills.candidateEmpty': 'Candidate profile has no skills yet.',
    'match.skills.covered': '{matched} of {required} required skills covered.',
    'match.skills.none': 'No strong skill overlap yet.',
    'match.industry.incomplete': 'Industry preference is incomplete.',
    'match.industry.aligns': 'Industry aligns with {industry}.',
    'match.industry.outside': 'Industry is outside declared interests.',
    'match.role.missing': 'Candidate role is missing.',
    'match.role.complements': '{candidate} complements {source}.',
    'match.role.same': '{candidate} is not the primary counterpart for this flow.',
    'match.role.plausible': 'Role fit is plausible but not explicit.',
    'match.capital.requirementMissing': 'Capital requirement is not declared.',
    'match.capital.availableMissing': 'Available capital is not declared.',
    'match.capital.belowFloor': 'Below the requested capital floor.',
    'match.capital.clears': 'Capital capacity clears the floor.',
    'match.trust.none': 'No reputation signal yet.',
    'match.trust.verified': 'Verified profile with reputation signal.',
    'match.trust.present': 'Reputation signal present.',
    'match.data.signals': '{filled} of {total} matching signals available.',

    /* idea submission */
    'idea.error.title': 'Idea title must be 5–200 characters.',
    'idea.error.industry': 'Industry must be 2–80 characters.',
    'idea.error.problem': 'Problem description must be at least 20 characters (max 5000).',
    'idea.error.skills': 'Required skills list cannot exceed 30 items.',
    'idea.error.submitFailed': 'Failed to submit your idea. Please try again.',
    'idea.toast.launched': 'Idea launched',
    'idea.toast.visionaryOnly': 'Only visionaries can submit ideas.',
    'idea.action.switchToVisionary': 'Switch to Visionary',

    /* settings */
    'settings.error.load': 'Failed to load profile. Please try again.',
    'settings.error.role': 'Please select a role.',
    'settings.error.name': 'Full name must be 2–80 characters.',
    'settings.error.skills': 'Please enter at least one skill (max 20).',
    'settings.error.save': 'Failed to save changes. Please try again.',
    'settings.toast.updated': 'Profile updated',
    'settings.toast.roleChanged': "You're a {role} now",

    /* auth */
    'auth.error.email': 'Please enter a valid email address.',
    'auth.error.passwordRequired': 'Password is required.',
    'auth.error.credentials': 'Incorrect email or password. Please try again.',
    'auth.error.magicLink': 'Failed to send magic link. Please try again.',
    'auth.error.name': 'Full name must be 2–80 characters.',
    'auth.error.passwordRule':
      'Password must be at least 8 characters and include at least one letter and one number.',
    'auth.error.role': 'Please select a role.',
    'auth.error.skills': 'Please enter at least one skill (comma-separated, max 20).',
    'auth.error.registerFailed': 'Registration failed. This email may already be in use.',
    'auth.error.accountSetup': 'Account setup failed. Please try again.',
    'auth.signIn': 'Sign In',
    'auth.email': 'Email',
    'auth.emailPh': 'you@example.com',
    'auth.password': 'Password',
    'auth.fullName': 'Full Name',
    'auth.fullNamePh': 'Your full name',
    'auth.passwordHintPh': 'Min 8 chars · letters + numbers',
    'auth.yourRole': 'Your Role',
    'auth.selectRole': 'Select your role',
    'auth.roleVisionary': 'Visionary — I have an idea to build',
    'auth.roleBuilder': 'Builder — I build things',
    'auth.roleEnabler': 'Enabler — I fund and enable',
    'auth.skills': 'Skills (comma-separated)',
    'auth.skillsPh': 'e.g. design, react, marketing',
    'auth.createAccount': 'Create Account',
    'auth.confirmMsg': 'Check your inbox — we sent you a confirmation link. Once verified, sign in above.',
    'idea.modalTitle': 'Launch Your Idea',
    'idea.roleGate':
      'Only <strong>Visionaries</strong> can submit ideas.<br>Update your role in your profile to continue.',
    'idea.titleLabel': 'Idea Title',
    'idea.titlePh': 'What is your idea called?',
    'idea.industryLabel': 'Industry',
    'idea.industryPh': 'e.g. FinTech, Healthcare, EdTech',
    'idea.problemLabel': 'Problem It Solves',
    'idea.problemPh': 'Describe the problem in detail (min 20 characters)...',
    'idea.skillsLabel': 'Skills Required (comma-separated, optional)',
    'idea.skillsPh': 'e.g. react, machine learning, finance',
    'idea.submit': 'Launch Idea',
    'settings.title': 'Account Settings',
    'settings.profilePhoto': 'Profile photo',
    'settings.upload': 'Upload',
    'settings.pasteUrl': 'Paste URL',
    'settings.remove': 'Remove',
    'settings.avatarFileAria': 'Choose an avatar image file',
    'settings.avatarUrlAria': 'Avatar image URL',
    'settings.skills': 'Skills',
    'settings.skillsPh': 'Type a skill, press Enter',
    'settings.roleVisionaryDesc': 'Submit ideas',
    'settings.roleBuilderDesc': 'Build products',
    'settings.roleEnablerDesc': 'Fund & connect',
    'settings.bio': 'Bio',
    'settings.bioPh': 'Who are you, in one breath?',
    'settings.interests': 'Interests',
    'settings.interestsPh': 'e.g. fintech, climate, web3',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save Changes',
    'ui.close': 'Close',
    'auth.toast.welcomeBack': 'Welcome back!',
    'auth.toast.magicSent': 'Magic link sent! Check your inbox.',
    'auth.toast.welcome': 'Welcome to UrLife!',
    'auth.toast.signedOut': 'Signed out successfully.',

    /* avatar & chip inputs */
    'avatar.error.format': 'Use PNG, JPEG, or WebP.',
    'avatar.error.upload': 'Upload failed.',
    'avatar.error.size': 'Choose an image smaller than 10 MB.',
    'avatar.error.https': 'URL must start with https://',
    'avatar.error.load': 'Could not load image from that URL.',
    'chips.max': 'Max {max} reached',

    /* booking modal fallback */
    'cal.fallback.msg': 'The booking calendar could not load here.',
    'cal.fallback.link': 'Open the calendar in a new tab',

    /* deal room */
    'deal.title': 'Closed Meeting Protocol',
    'deal.operators': 'Matched Operators',
    'deal.projectLead': 'Project Lead',
    'deal.initiator': 'Initiator',
    'deal.partner': 'Partner',
    'deal.anonymousOperator': 'Anonymous Operator',
    'deal.terms': 'Partnership Terms',
    'deal.equity': 'Equity Allocation (%)',
    'deal.revenue': 'Revenue Share (%)',
    'deal.milestone': 'Key Milestone to Unlock Escrow',
    'deal.equityPh': 'e.g. 15',
    'deal.revenuePh': 'e.g. 5',
    'deal.milestonePh': 'e.g. MVP Launch / Smart Contract Audit',
    'deal.cancel': 'Cancel',
    'deal.sign': 'Cryptographic Sign & Lock',
    'deal.locked': 'Locked in Escrow',
    'deal.error.fillAll': 'Please fill out all terms to proceed.',

    /* nav / shell strings owned by the console session state */
    'nav.settingsAria': 'Account Settings',
    'nav.signOut': 'Sign Out',
    'nav.refresh': '↻ Refresh',

    /* app shell notices (dynamically imported by eager modules when fired) */
    'sw.update.msg': 'A new version of UrLife is ready.',
    'sw.update.reload': 'Update now',
    'net.offline': 'You are offline. Cached content is shown; sign-in and submissions are paused.',
  },

  ar: {
    /* الأدوار والحالات (مفردات مشتركة) */
    'role.visionary': 'صاحب الفكرة',
    'role.builder': 'البنّاء',
    'role.enabler': 'الممكّن',
    'role.member': 'عضو',
    'status.pending': 'قيد الانتظار',
    'status.acknowledged': 'تمت المشاهدة',
    'status.accepted': 'مقبول',
    'status.declined': 'مرفوض',
    'status.withdrawn': 'مسحوب',
    'tier.gold': 'ذهبي',
    'tier.silver': 'فضي',
    'tier.bronze': 'برونزي',

    /* لوحة التحكم */
    'nx.score': 'النتيجة',
    'nx.confidence': 'ثقة {value}%',
    'nx.error': 'حدث خطأ. تحقّق من اتصالك وحاول مجدداً.',
    'nx.retry': 'إعادة المحاولة',
    'nx.empty.visionary.title': 'لا توجد أفكار بعد.',
    'nx.empty.visionary.sub': 'قدّم فكرتك الأولى — وسيجد المحرك فريقك.',
    'nx.empty.operator.title': 'لا توجد أفكار مفتوحة مطابقة بعد.',
    'nx.empty.operator.sub': 'أضِف مهاراتك واهتماماتك في الإعدادات ليتمكن المحرك من ترتيب فرص أنسب لك.',
    'nx.anonymous': 'عضو غير معروف',
    'nx.recommendedMember': 'عضو موصى به',
    'nx.untitled': 'بدون عنوان',
    'nx.untitledIdea': 'فكرة بدون عنوان',
    'nx.uncategorised': 'غير مصنّفة',
    'nx.verified': 'موثّق',
    'nx.accept': 'قبول',
    'nx.decline': 'رفض',
    'nx.withdraw': 'سحب',
    'nx.express': 'أنا مهتم',
    'nx.dealRoom': 'افتح غرفة الصفقة',
    'nx.readiness': 'الجاهزية',
    'nx.readinessAria': 'جاهزية الفكرة',
    'nx.incomingInterest.zero': 'لا اهتمامات واردة بعد',
    'nx.incomingInterest.one': 'اهتمام واحد وارد',
    'nx.incomingInterest.two': 'اهتمامان واردان',
    'nx.incomingInterest.few': '{count} اهتمامات واردة',
    'nx.incomingInterest.many': '{count} اهتماماً وارداً',
    'nx.incomingInterest.other': '{count} اهتمام وارد',
    'nx.interestedCount.zero': 'لا اهتمام بعد',
    'nx.interestedCount.one': 'مهتم واحد',
    'nx.interestedCount.two': 'مهتمان',
    'nx.interestedCount.few': '{count} مهتمين',
    'nx.interestedCount.many': '{count} مهتماً',
    'nx.interestedCount.other': '{count} مهتم',
    'nx.noInterestYet': 'لم يُبادر أحد بالاهتمام بعد. التوصيات أدناه تُظهر من تبدأ بدعوته.',
    'nx.recommendedOperators': 'المنفّذون الموصى بهم',
    'nx.recommendedOperatorsAria': 'منفّذون موصى بهم لفكرة «{title}»',
    'nx.interestAria': 'الاهتمام بفكرة «{title}»',
    'nx.improveRecommendations': 'أضِف مهارات مطلوبة أكثر لتحسين التوصيات.',
    'nx.for': 'لفكرة: {title}',
    'nx.spotlight.visionary.title': 'أفضل دعوات المنفّذين',
    'nx.spotlight.visionary.sub': 'مرتبة حسب مهاراتك المطلوبة وصناعتك وإشارات الثقة حول المنفّذين.',
    'nx.spotlight.operator.title': 'الاجتماعات الموصى بها التالية',
    'nx.spotlight.operator.sub': 'مرتبة حسب توافق الدور والمهارات واهتمامات الصناعة وثقة الملف الشخصي.',
    'nx.header': 'NEXUS — {name}',
    'nx.welcome': 'أهلاً',
    'nx.interestBadge.pending': 'اهتمام قيد الانتظار',
    'nx.interestBadge.acknowledged': 'اهتمام تمت مشاهدة',
    'nx.interestBadge.accepted': 'اهتمام مقبول',
    'nx.interestBadge.declined': 'اهتمام مرفوض',
    'nx.interestBadge.withdrawn': 'اهتمام مسحوب',
    'nx.toast.interestSent': 'أُرسل اهتمامك إلى صاحب الفكرة.',
    'nx.toast.interestDuplicate': 'لقد عبّرت عن اهتمامك بهذه الفكرة سابقاً.',
    'nx.toast.interestSendFailed': 'تعذّر إرسال الاهتمام. حاول مجدداً.',
    'nx.toast.interestUpdateFailed': 'تعذّر تحديث الاهتمام. حاول مجدداً.',
    'nx.toast.dealLocked': 'تم تثبيت بروتوكول الاجتماع المغلق.',
    'nx.toast.interestStatus.pending': 'الاهتمام قيد الانتظار.',
    'nx.toast.interestStatus.acknowledged': 'تمت مشاهدة الاهتمام.',
    'nx.toast.interestStatus.accepted': 'تم قبول الاهتمام.',
    'nx.toast.interestStatus.declined': 'تم رفض الاهتمام.',
    'nx.toast.interestStatus.withdrawn': 'تم سحب الاهتمام.',

    /* ملاحظات محرك المطابقة */
    'match.axis.skills': 'المهارات',
    'match.axis.industry': 'الصناعة',
    'match.axis.role': 'الدور',
    'match.axis.capital': 'رأس المال',
    'match.axis.trust': 'الثقة',
    'match.axis.data': 'البيانات',
    'match.tier.Perfect Match': 'تطابق تام',
    'match.tier.Strong Match': 'تطابق قوي',
    'match.tier.Viable Match': 'تطابق ممكن',
    'match.tier.Weak Match': 'تطابق ضعيف',
    'match.tier.Not Recommended': 'غير موصى به',
    'match.skills.ideaEmpty': 'لم تُحدَّد المهارات المطلوبة في الفكرة بعد.',
    'match.skills.candidateEmpty': 'لا توجد مهارات في ملف المرشّح بعد.',
    'match.skills.covered': 'تغطية {matched} من أصل {required} من المهارات المطلوبة.',
    'match.skills.none': 'لا يوجد تقاطع قوي في المهارات بعد.',
    'match.industry.incomplete': 'تفضيل الصناعة غير مكتمل.',
    'match.industry.aligns': 'الصناعة تتوافق مع {industry}.',
    'match.industry.outside': 'الصناعة خارج الاهتمامات المعلنة.',
    'match.role.missing': 'دور المرشّح غير محدد.',
    'match.role.complements': '{candidate} يكمل {source}.',
    'match.role.same': '{candidate} ليس الطرف المقابل الأساسي في هذا المسار.',
    'match.role.plausible': 'توافق الأدوار ممكن لكنه غير صريح.',
    'match.capital.requirementMissing': 'لم يُعلَن عن حاجة لرأس المال.',
    'match.capital.availableMissing': 'لم يُعلَن عن رأس المال المتاح.',
    'match.capital.belowFloor': 'أقل من الحد الأدنى المطلوب لرأس المال.',
    'match.capital.clears': 'القدرة المالية تتجاوز الحد الأدنى.',
    'match.trust.none': 'لا توجد إشارة ثقة بعد.',
    'match.trust.verified': 'ملف موثّق مع إشارة ثقة.',
    'match.trust.present': 'توجد إشارة ثقة.',
    'match.data.signals': 'تتوفر {filled} من أصل {total} من إشارات المطابقة.',

    /* تقديم الأفكار */
    'idea.error.title': 'عنوان الفكرة يجب أن يكون بين 5 و200 حرف.',
    'idea.error.industry': 'الصناعة يجب أن تكون بين 2 و80 حرفاً.',
    'idea.error.problem': 'وصف المشكلة يجب أن يكون 20 حرفاً على الأقل (الحد الأقصى 5000).',
    'idea.error.skills': 'قائمة المهارات المطلوبة لا يمكن أن تتجاوز 30 مهارة.',
    'idea.error.submitFailed': 'تعذّر تقديم فكرتك. حاول مجدداً.',
    'idea.toast.launched': 'انطلقت الفكرة',
    'idea.toast.visionaryOnly': 'أصحاب الأفكار فقط يمكنهم تقديم الأفكار.',
    'idea.action.switchToVisionary': 'التحوّل إلى صاحب فكرة',

    /* الإعدادات */
    'settings.error.load': 'تعذّر تحميل الملف الشخصي. حاول مجدداً.',
    'settings.error.role': 'اختر دوراً من فضلك.',
    'settings.error.name': 'الاسم الكامل يجب أن يكون بين 2 و80 حرفاً.',
    'settings.error.skills': 'أدخِل مهارة واحدة على الأقل (الحد الأقصى 20).',
    'settings.error.save': 'تعذّر حفظ التغييرات. حاول مجدداً.',
    'settings.toast.updated': 'تم تحديث الملف الشخصي',
    'settings.toast.roleChanged': 'أصبحت {role} الآن',

    /* الحساب */
    'auth.error.email': 'أدخِل بريداً إلكترونياً صحيحاً.',
    'auth.error.passwordRequired': 'كلمة المرور مطلوبة.',
    'auth.error.credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول مجدداً.',
    'auth.error.magicLink': 'تعذّر إرسال رابط الدخول السحري. حاول مجدداً.',
    'auth.error.name': 'الاسم الكامل يجب أن يكون بين 2 و80 حرفاً.',
    'auth.error.passwordRule':
      'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتتضمن حرفاً واحداً ورقماً واحداً على الأقل.',
    'auth.error.role': 'اختر دوراً من فضلك.',
    'auth.error.skills': 'أدخِل مهارة واحدة على الأقل (مفصولة بفواصل، الحد الأقصى 20).',
    'auth.error.registerFailed': 'فشل التسجيل. قد يكون هذا البريد مستخدماً بالفعل.',
    'auth.error.accountSetup': 'تعذّر إعداد الحساب. حاول مجدداً.',
    'auth.signIn': 'تسجيل الدخول',
    'auth.email': 'البريد الإلكتروني',
    'auth.emailPh': 'you@example.com',
    'auth.password': 'كلمة المرور',
    'auth.fullName': 'الاسم الكامل',
    'auth.fullNamePh': 'اسمك الكامل',
    'auth.passwordHintPh': '8 أحرف على الأقل · حروف + أرقام',
    'auth.yourRole': 'دورك',
    'auth.selectRole': 'اختر دورك',
    'auth.roleVisionary': 'صاحب فكرة — لديّ فكرة أريد بناءها',
    'auth.roleBuilder': 'بنّاء — أنا أبني الأشياء',
    'auth.roleEnabler': 'ممكّن — أنا أموّل وأمكّن',
    'auth.skills': 'المهارات (مفصولة بفواصل)',
    'auth.skillsPh': 'مثال: تصميم، React، تسويق',
    'auth.createAccount': 'إنشاء حساب',
    'auth.confirmMsg': 'تفقّد بريدك الوارد — أرسلنا لك رابط تأكيد. بعد التحقق، سجّل الدخول أعلاه.',
    'idea.modalTitle': 'أطلق فكرتك',
    'idea.roleGate':
      '<strong>أصحاب الأفكار</strong> فقط يمكنهم تقديم الأفكار.<br>حدّث دورك في ملفك الشخصي للمتابعة.',
    'idea.titleLabel': 'عنوان الفكرة',
    'idea.titlePh': 'ما اسم فكرتك؟',
    'idea.industryLabel': 'الصناعة',
    'idea.industryPh': 'مثال: تقنية مالية، صحة، تعليم',
    'idea.problemLabel': 'المشكلة التي تحلها',
    'idea.problemPh': 'صف المشكلة بالتفصيل (20 حرفاً على الأقل)...',
    'idea.skillsLabel': 'المهارات المطلوبة (مفصولة بفواصل، اختياري)',
    'idea.skillsPh': 'مثال: React، تعلم الآلة، تمويل',
    'idea.submit': 'إطلاق الفكرة',
    'settings.title': 'إعدادات الحساب',
    'settings.profilePhoto': 'الصورة الشخصية',
    'settings.upload': 'رفع صورة',
    'settings.pasteUrl': 'لصق رابط',
    'settings.remove': 'إزالة',
    'settings.avatarFileAria': 'اختر ملف صورة للصورة الشخصية',
    'settings.avatarUrlAria': 'رابط الصورة الشخصية',
    'settings.skills': 'المهارات',
    'settings.skillsPh': 'اكتب مهارة واضغط Enter',
    'settings.roleVisionaryDesc': 'تقديم الأفكار',
    'settings.roleBuilderDesc': 'بناء المنتجات',
    'settings.roleEnablerDesc': 'تمويل وربط',
    'settings.bio': 'نبذة',
    'settings.bioPh': 'من أنت، في نَفَس واحد؟',
    'settings.interests': 'الاهتمامات',
    'settings.interestsPh': 'مثال: تقنية مالية، مناخ، ويب3',
    'settings.cancel': 'إلغاء',
    'settings.save': 'حفظ التغييرات',
    'ui.close': 'إغلاق',
    'auth.toast.welcomeBack': 'أهلاً بعودتك!',
    'auth.toast.magicSent': 'أُرسل الرابط السحري! تفقّد بريدك الوارد.',
    'auth.toast.welcome': 'أهلاً بك في UrLife!',
    'auth.toast.signedOut': 'تم تسجيل الخروج.',

    /* الصورة الشخصية والمهارات */
    'avatar.error.format': 'استخدم PNG أو JPEG أو WebP.',
    'avatar.error.upload': 'فشل الرفع.',
    'avatar.error.size': 'اختر صورة بحجم أقل من 10 ميجابايت.',
    'avatar.error.https': 'يجب أن يبدأ الرابط بـ https://',
    'avatar.error.load': 'تعذّر تحميل الصورة من ذلك الرابط.',
    'chips.max': 'بلغت الحد الأقصى ({max})',

    /* التعذّر في نافذة الحجز */
    'cal.fallback.msg': 'تعذّر تحميل تقويم الحجز هنا.',
    'cal.fallback.link': 'افتح التقويم في تبويب جديد',

    /* غرفة الصفقة */
    'deal.title': 'بروتوكول الاجتماع المغلق',
    'deal.operators': 'المنفّذون المتوافقون',
    'deal.projectLead': 'قائد المشروع',
    'deal.initiator': 'المُبادِر',
    'deal.partner': 'شريك',
    'deal.anonymousOperator': 'منفّذ غير معروف',
    'deal.terms': 'شروط الشراكة',
    'deal.equity': 'توزيع الحصص (%)',
    'deal.revenue': 'مشاركة الإيرادات (%)',
    'deal.milestone': 'الإنجاز الرئيسي لفتح الضمان',
    'deal.equityPh': 'مثال: 15',
    'deal.revenuePh': 'مثال: 5',
    'deal.milestonePh': 'مثال: إطلاق MVP / تدقيق العقد الذكي',
    'deal.cancel': 'إلغاء',
    'deal.sign': 'توقيع رقمي وتثبيت',
    'deal.locked': 'مثبَّت في الضمان',
    'deal.error.fillAll': 'يرجى تعبئة جميع الشروط للمتابعة.',

    /* أزرار الجلسة في الشريط العلوي */
    'nav.settingsAria': 'إعدادات الحساب',
    'nav.signOut': 'تسجيل الخروج',
    'nav.refresh': '↻ تحديث',

    /* إشعارات النظام */
    'sw.update.msg': 'يتوفر إصدار جديد من UrLife.',
    'sw.update.reload': 'حدّث الآن',
    'net.offline': 'أنت غير متصل. يُعرض المحتوى المخزَّن؛ تسجيل الدخول والإرسال متوقفان مؤقتاً.',
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Lookup
 * ───────────────────────────────────────────────────────────────────────── */

const pluralRules = {
  en: new Intl.PluralRules('en'),
  ar: new Intl.PluralRules('ar'),
};

/**
 * Translate a key with `{param}` interpolation.
 * Falls back to English, then to the key itself — a missing key must never
 * blank out a control, and the raw key makes the gap obvious in review.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
  const lang = getLanguage();
  const table = STRINGS[lang] ?? STRINGS.en;
  let str = table[key] ?? STRINGS.en[key] ?? key;
  // `params` must be a plain object; anything else (e.g. a fallback string
  // passed by a caller) is ignored rather than mis-interpolated.
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [name, value] of Object.entries(params)) {
      str = str.replaceAll(`{${name}}`, String(value));
    }
  }
  return str;
}

/**
 * Translate a plural family (`key.zero/one/two/few/many/other`) using the
 * real CLDR plural category for the active language. Arabic has all six;
 * English only distinguishes one/other.
 * @param {string} key
 * @param {number} count
 * @param {Record<string, string|number>} [params] extra params beyond {count}
 */
export function tCount(key, count, params = {}) {
  const lang = getLanguage();
  const rules = pluralRules[lang] ?? pluralRules.en;
  // Arabic already maps 0 → the CLDR 'zero' category. English puts 0 in
  // 'other', but when the dictionary provides an explicit `.zero` phrasing
  // ("No incoming interest yet") it wins over "0 incoming interests".
  const table = STRINGS[lang] ?? STRINGS.en;
  const category =
    count === 0 && (table[`${key}.zero`] || STRINGS.en[`${key}.zero`]) ? 'zero' : rules.select(count);
  const str = table[`${key}.${category}`] ?? STRINGS.en[`${key}.${category}`] ?? table[`${key}.other`] ?? key;
  return t(str, { count, ...params });
}

/**
 * Locale-aware short date ("Mar 12" / "12 مارس") for the active language.
 * Arabic is formatted with Latin digits to stay consistent with the scores
 * and percentages rendered next to it.
 * @param {string|Date} value
 */
export function localeShortDate(value) {
  if (!value) return '';
  try {
    const lang = getLanguage();
    const locale = lang === 'ar' ? 'ar-u-nu-latn' : 'en';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value));
  } catch {
    return '';
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Static console markup (data-i18n keys in index.html)
 * ───────────────────────────────────────────────────────────────────────── */

const ATTR_TARGETS = {
  'data-i18n': (el, v) => {
    el.textContent = t(v);
  },
  // Rich variant for copy that legitimately contains inline markup. The value
  // goes through renderRichText() — the same allow-list sanitiser used for
  // data-ar translations — so a translation can never smuggle a tag in.
  'data-i18n-rich': (el, v) => {
    el.replaceChildren(renderRichText(t(v)));
  },
  'data-i18n-placeholder': (el, v) => {
    el.setAttribute('placeholder', t(v));
  },
  'data-i18n-aria': (el, v) => {
    el.setAttribute('aria-label', t(v));
  },
  'data-i18n-title': (el, v) => {
    el.setAttribute('title', t(v));
  },
};

/** Resolve every `data-i18n*` key in `root` against the active language. */
export function applyConsoleTranslations(root = document) {
  for (const [attr, apply] of Object.entries(ATTR_TARGETS)) {
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      const key = el.getAttribute(attr);
      if (key) apply(el, key);
    });
  }
}

let _initialised = false;

/**
 * Own the `urlife:langchange` re-translation for console markup. Idempotent.
 * Called by the console bootstrap (src/app/account.js), not by the page boot:
 * the landing page owes the dictionary nothing until the console loads.
 */
export function initConsoleI18n({ root = document } = {}) {
  if (_initialised) return;
  _initialised = true;
  applyConsoleTranslations(root);
  window.addEventListener('urlife:langchange', () => applyConsoleTranslations(root));
}

/** Test seam — allows a spec to re-init against a fresh DOM. */
export function __resetConsoleI18nForTests() {
  _initialised = false;
}
