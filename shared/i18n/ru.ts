/**
 * Russian, for Riga. Empty for now: every key falls back to English.
 *
 * Spec, open questions: launch in English, the Russian translation within the
 * first month. Translate by adding keys from `en.ts`; nothing else changes.
 */
import type { Message } from './types'
import type { MessageKey } from './en'

export const ru: Partial<Record<MessageKey, Message>> = {
  // A push without its own words shows this as its title (sw.js); the sender's
  // words are already Russian (supabase/functions/_shared/pushText.ts).
  'mobile.pushFallbackTitle': "Новое уведомление",
  'settings.previewRecipient': "Анна Иванова",
  'settings.previewClinicFallback': "Ваша клиника",
  'settings.tokenArve': "Номер счёта",
  'settings.tokenSaaja': "Кому адресован счёт",
  'settings.tokenSumma': "Итого к оплате",
  'settings.tokenTasumata': "Неоплаченный остаток",
  'settings.tokenTahtaeg': "Срок оплаты",
  'settings.tokenKuupaev': "Дата счёта",
  'settings.tokenKliinik': "Название клиники",
  'wizard.materialsLine': "Материалы",
  'wizard.noteLine': "Примечание",
  'workers.lvTaxProfile': "Налоговый профиль (Латвия)",
  'workers.lvTaxBooklet': "Налоговая книжка у нас",
  'workers.lvDependents': "Иждивенцы",
  'workers.lvPensioner': "Пенсионер",
  'workers.lvYes': "Да",
  'workers.lvNo': "Нет",
  'workers.lvTaxProfileHelp': "Если налоговая книжка у нас, {minimum} € в месяц не облагаются налогом. Каждый иждивенец уменьшает облагаемую сумму ещё на {dependent} €. Пенсионер платит меньший социальный налог.",
  'workers.lvSocialEmployee': "Соц. налог {pct}%",
  'workers.lvIncomeTax': "Подоходный налог {pct}%",
  'workers.lvEmployerSocial': "Соц. налог работодателя {pct}%",
  'workers.lvMinWageNote': "Брутто ниже минимальной зарплаты, поэтому соц. налог считается с {min} €.",
  'workers.lvEstimateNote': "Оценка по латвийским ставкам {year} года. Это не бухгалтерский расчётный лист.",
  'settingsPage.lvTaxTitle': "Налоги на зарплату: Латвия {year}",
  'settingsPage.lvTaxRules': "Устанавливается автоматически по стране клиники. Соц. налог: работник {employee}%, работодатель {employer}% (пенсионер {pEmployee}% / {pEmployer}%). Подоходный налог {income}%. Необлагаемый минимум с налоговой книжкой: {minimum} € в месяц, плюс {dependent} € на каждого иждивенца. Соц. налог считается минимум с минимальной зарплаты, {minWage} €.",
}
