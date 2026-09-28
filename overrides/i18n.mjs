const phrases = [
 ['Темна','Тёмная','Dark'],['Стандартна','Стандартная','Standard'],['Авто','Авто','Auto'],['Вибрати тему','Выбрать тему','Choose theme'],['Виберіть вашу тему','Выберите вашу тему','Choose your theme'],['Виберіть бажану тему, щоб налаштувати інтерфейс','Выберите предпочтительную тему, чтобы настроить интерфейс','Choose your preferred interface theme'],['Темна тема для всіх розділів','Тёмная тема для всех разделов','Dark theme for every section'],['Світлий спорт, темне казино','Светлый спорт, тёмное казино','Light sports, dark casino'],['Відповідає налаштуванням вашого пристрою','Соответствует настройкам вашего устройства','Matches your device settings'],['Мій акаунт','Мой аккаунт','My account'],['Служба підтримки','Служба поддержки','Support'],['Бонуси','Бонусы','Bonuses'],
 ['Головне','Главное','Main'],['Події','События','Events'],['Час матчів','Время матчей','Match time'],
 ['Головна','Главная','Home'],['Спорт','Спорт','Sport'],['Мої ставки','Мои ставки','My bets'],['Казино','Казино','Casino'],['Профіль','Профиль','Profile'],['Меню','Меню','Menu'],
 ['Поповнити','Пополнить','Deposit'],['Поповнити рахунок','Пополнить счёт','Deposit funds'],['+ Поповнити рахунок','+ Пополнить счёт','+ Deposit funds'],['Вивести','Вывести','Withdraw'],['Баланс','Баланс','Balance'],
 ['Акції','Акции','Promotions'],['Персональні дані','Персональные данные','Personal details'],['Підтвердження акаунта','Подтверждение аккаунта','Account verification'],['Історія платежів','История платежей','Payment history'],
 ['Залишити відгук','Оставить отзыв','Leave feedback'],['Налаштування','Настройки','Settings'],['Допомога та інформація','Помощь и информация','Help and information'],['Вихід','Выход','Log out'],['Вийти','Выйти','Log out'],['Вийти з акаунта','Выйти из аккаунта','Log out of account'],
 ['Змінити мову','Изменить язык','Change language'],['Редагувати ставки','Редактировать ставки','Edit bets'],['Видалити','Удалить','Delete'],['Мова','Язык','Language'],['Безпека','Безопасность','Security'],['Налаштування сповіщень','Настройки уведомлений','Notification settings'],['Налаштування спорту','Настройки спорта','Sport settings'],['Зберегти','Сохранить','Save'],
 ['Магазин бонусів','Магазин бонусов','Bonus shop'],['Турніри','Турниры','Tournaments'],['Головне','Главное','Overview'],['Події','События','Events'],
 ['Нерозраховані','Нерассчитанные','Unsettled'],['Розраховані','Рассчитанные','Settled'],['Сума ставки','Сумма ставки','Stake'],['Можлива виплата','Возможная выплата','Potential payout'],['Виплата','Выплата','Payout'],
 ['Повторити','Повторить','Repeat'],['Поділитися','Поделиться','Share'],['Поділитися ставкою','Поделиться ставкой','Share bet'],['Показати суму ставки:','Показать сумму ставки:','Show stake:'],['Зберегти зображення','Сохранить изображение','Save image'],['зображення','изображение','image'],['ставкою','ставкой','bet'],
 ['Переможець','Победитель','Winner'],['Результат матчу','Результат матча','Match result'],['Тотал','Тотал','Total'],['Тотал карт','Тотал карт','Total maps'],['Фора','Фора','Handicap'],['Фора за картами','Фора по картам','Map handicap'],['Точний рахунок','Точный счёт','Correct score'],['Точний рахунок за картами','Точный счёт по картам','Correct map score'],['Нічия','Ничья','Draw'],['Більше','Больше','Over'],['Менше','Меньше','Under'],['Парний / непарний','Чётный / нечётный','Even / odd'],['Парний','Чётный','Even'],['Непарний','Нечётный','Odd'],
 ['Переможець матчу','Победитель матча','Match winner'],['Рахунок','Счёт','Score'],['Вибір у ставці','Выбор в ставке','Bet selection'],['Вибраний результат','Выбранный исход','Selected outcome'],['Фактичний результат','Фактический результат','Actual result'],['Не зіграно','Не сыграно','Not played'],['За рахунком','По счёту','By score'],
 ['Редагувати ставку','Редактировать ставку','Edit bet'],['Номер ставки','Номер ставки','Bet number'],['Статус ставки','Статус ставки','Bet status'],['Пункти ставки','Пункты ставки','Bet selections'],['Зберегти зміни','Сохранить изменения','Save changes'],['Приховати ставку з історії','Скрыть ставку из истории','Hide bet from history'],['Не вдалося зберегти зміни','Не удалось сохранить изменения','Could not save changes'],
 ['Відкрий потрібний пункт ставки та змінюй сам ринок, вибраний результат, коефіцієнт або фактичний результат. Наприклад, точний рахунок по картах 3:0 можна змінити на 3:2.','Открой нужный пункт ставки и измени сам рынок, выбранный исход, коэффициент или фактический результат. Например, точный счёт по картам 3:0 можно изменить на 3:2.','Open the required bet selection and change the market, selected outcome, odds or actual result. For example, a correct map score of 3:0 can be changed to 3:2.'],
 ['Завантаження історії зустрічей','Загрузка истории встреч','Loading match history'],['Історія зустрічей тимчасово недоступна.','История встреч временно недоступна.','Match history is temporarily unavailable.'],['Для цього матчу зараз немає доступних коефіцієнтів.','Для этого матча сейчас нет доступных коэффициентов.','No odds are currently available for this match.'],['Ринки цього матчу зараз недоступні','Рынки этого матча сейчас недоступны','Markets for this match are currently unavailable'],['Немає з’єднання з джерелом матчів','Нет соединения с источником матчей','No connection to the match feed'],
 ['Додайте результат до купона','Добавьте исход в купон','Add a selection to the bet slip'],['Перевірте тип купона','Проверьте тип купона','Check the bet slip type'],['Додайте щонайменше два результати','Добавьте минимум два исхода','Add at least two selections'],['Для системи додайте щонайменше три результати','Для системы добавьте минимум три исхода','Add at least three selections for a system bet'],['У купоні повторюється результат','В купоне повторяется исход','The bet slip contains a duplicate selection'],['В експресі або системі не можна вибрати два результати одного матчу','В экспрессе или системе нельзя выбрать два исхода одного матча','An accumulator or system bet cannot contain two selections from the same match'],['Некоректний номер ставки','Некорректный номер ставки','Invalid bet number'],['Не вдалося зарахувати виплату','Не удалось зачислить выплату','Could not credit the payout'],
 ['Акаунт Arena Line. Не вводьте дані від акаунта Parik24.','Аккаунт Arena Line. Не вводите данные от аккаунта Parik24.','Arena Line account. Do not enter your Parik24 account details.'],['Вже є акаунт? Увійти','Уже есть аккаунт? Войти','Already have an account? Sign in'],['Сума, €','Сумма, €','Amount, €'],['Додавання віртуальних коштів. Реального переказу грошей не буде.','Добавление виртуальных средств. Реального перевода денег не будет.','Adding virtual funds. No real money will be transferred.'],['Списання віртуальних коштів. Реального переказу грошей не буде.','Списание виртуальных средств. Реального перевода денег не будет.','Withdrawing virtual funds. No real money will be transferred.'],
 ['Лінія матчу','Линия матча','Match line'],['Ринок з лінії','Рынок из линии','Market from line'],['Оберіть ринок','Выберите рынок','Choose market'],['Оберіть результат','Выберите исход','Choose outcome'],['Завантаження лінії матчу…','Загрузка линии матча…','Loading match line…'],['Лінія матчу зараз недоступна','Линия матча сейчас недоступна','Match line is currently unavailable'],['Ручний ввід','Ручной ввод','Manual input'],
 ['Дублювати ставку','Дублировать ставку','Duplicate bet'],['Ставку продубльовано','Ставка продублирована','Bet duplicated'],['Недостатньо коштів для дублювання ставки','Недостаточно средств для дублирования ставки','Insufficient funds to duplicate the bet'],
 ['Ординар','Ординар','Single'],['Експрес','Экспресс','Accumulator'],['Система','Система','System'],['Лайв','Лайв','Live'],['ЛАЙВ','ЛАЙВ','LIVE'],['Прематч','Прематч','Prematch'],['ПРЕМАТЧ','ПРЕМАТЧ','PREMATCH'],['ЛОББІ','ЛОББИ','LOBBY'],['ПЕРЕРВА','ПЕРЕРЫВ','BREAK'],['СЬОГОДНІ','СЕГОДНЯ','TODAY'],['ЗАВЕРШЕНО','ЗАВЕРШЕНО','FINISHED'],
 ['Вибране','Избранное','Favorites'],['Футбол','Футбол','Football'],['Теніс','Теннис','Tennis'],['Настільний теніс','Настольный теннис','Table tennis'],['Хокей','Хоккей','Hockey'],['Кіберспорт','Киберспорт','Esports'],['Баскетбол','Баскетбол','Basketball'],['Волейбол','Волейбол','Volleyball'],['Снукер','Снукер','Snooker'],
 ['Всі','Все','All'],['Основне','Основное','Main'],['Всі події','Все события','All events'],['Скоро','Скоро','Soon'],['Сьогодні','Сегодня','Today'],['Завтра','Завтра','Tomorrow'],['Вихідні','Выходные','Weekend'],['Огляд матчу','Обзор матча','Match overview'],['Огляд коефіцієнтів','Обзор коэффициентов','Odds overview'],['Особисті зустрічі','Личные встречи','Head to head'],['При відкритті','При открытии','On opening'],['Зараз','Сейчас','Now'],['Результат','Результат','Result'],
 ['Увійти','Войти','Sign in'],['Увійти','Увійти','Sign in'],['Реєстрація','Регистрация','Registration'],['Вхід','Вход','Sign in'],['Створити акаунт','Создать аккаунт','Create account'],['Ім’я','Имя','First name'],['Прізвище','Фамилия','Last name'],['Пароль','Пароль','Password'],['Змінити пароль','Изменить пароль','Change password'],['Поточний пароль','Текущий пароль','Current password'],['Новий пароль','Новый пароль','New password'],['Контакти','Контакты','Contact details'],['Номер рахунку','Номер счёта','Account number'],['Номер телефону','Номер телефона','Phone number'],['Не вказано','Не указан','Not provided'],['Персональна інформація','Персональная информация','Personal information'],['Мої дані','Мои данные','My details'],
 ['Назад','Назад','Back'],['Закрити','Закрыть','Close'],['Пошук','Поиск','Search'],['Сповіщення','Уведомления','Notifications'],['Нових сповіщень немає','Новых уведомлений нет','No new notifications'],['Допомога','Помощь','Help'],['Продовжити','Продолжить','Continue'],
 ['Зробити ставку','Сделать ставку','Place bet'],['Ставку прийнято','Ставка принята','Bet accepted'],['Сума купону','Сумма купона','Bet slip total'],['Можливий виграш','Возможный выигрыш','Potential winnings'],['Твій купон порожній','Твой купон пуст','Your bet slip is empty'],['Клікни на коефіцієнт, щоб додати ставку до купону','Нажми на коэффициент, чтобы добавить ставку в купон','Select odds to add a bet to your slip'],['На все','На всё','All in'],['Коефіцієнти недоступні','Коэффициенты недоступны','Odds unavailable'],['Прийняти зміни коефіцієнтів','Принять изменения коэффициентов','Accept odds changes'],
 ['Оновити','Обновить','Refresh'],['Пошук матчу','Поиск матча','Search matches'],['Команда або турнір','Команда или турнир','Team or tournament'],['Матчів не знайдено','Матчи не найдены','No matches found'],['Завантаження матчів','Загрузка матчей','Loading matches'],['Завантаження коефіцієнтів…','Загрузка коэффициентов…','Loading odds…'],['Ринки призупинено','Рынки приостановлены','Markets suspended'],['Вибраних матчів поки немає','Избранных матчей пока нет','No favorite matches yet'],['У цьому розділі зараз немає матчів','В этом разделе сейчас нет матчей','No matches in this section'],['Переглянути прематч','Посмотреть прематч','View prematch'],['До спорту','К спорту','Back to sport'],
 ['Нерозрахованих ставок немає','Нерассчитанных ставок нет','No unsettled bets'],['Розрахованих ставок ще немає','Рассчитанных ставок ещё нет','No settled bets yet'],['Операцій поки немає','Операций пока нет','No transactions yet'],['Виплата за ставкою','Выплата по ставке','Bet payout'],['Поповнення','Пополнение','Deposit'],['Виведення','Вывод','Withdrawal'],
 ['Активних бонусів немає','Активных бонусов нет','No active bonuses'],['Відгук','Отзыв','Feedback'],['Текст відгуку','Текст отзыва','Your feedback'],['Зберегти відгук','Сохранить отзыв','Save feedback'],['Відгук збережено на цьому пристрої','Отзыв сохранён на этом устройстве','Feedback saved on this device'],['Розрахунок ставок','Расчёт ставок','Bet settlement'],['Початковий розділ','Начальный раздел','Default section'],['Сортування матчів','Сортировка матчей','Match sorting'],['За часом','По времени','By start time'],['За турніром','По турниру','By tournament'],
 ['Готуємо купон…','Готовим купон…','Preparing coupon…'],['Профіль і віртуальний баланс зберігаються в цьому браузері.','Профиль и виртуальный баланс хранятся в этом браузере.','Your profile and virtual balance are stored in this browser.'],['Дані цього профілю належать лише Arena Line.','Данные этого профиля относятся только к Arena Line.','This profile belongs only to Arena Line.'],['Зміни з моменту відкриття цієї сторінки. Поточні коефіцієнти оновлюються з лінії.','Изменения с момента открытия этой страницы. Текущие коэффициенты обновляются из линии.','Changes since this page was opened. Current odds update from the live feed.'],
 ["Дозвольте зберігання даних сайту в браузері","Разрешите хранение данных сайта в браузере","Allow this site to store data in your browser"],
 ["Копіювати номер рахунку","Копировать номер счёта","Copy account number"],
 ["Копіювати","Копировать","Copy"],
 ["Акаунт створено","Аккаунт создан","Account created"],
 ["Вхід за електронною поштою та паролем.","Вход по почте и паролю.","Sign in with email and password."],
 ["Віртуальний рахунок активний.","Виртуальный счёт активен.","Virtual account is active."],
 ["Для цього профілю поки немає нагород.","Для этого профиля пока нет наград.","No rewards for this profile yet."],
 ["У профілі немає активних бонусних турнірів.","В профиле нет активных бонусных турниров.","There are no active bonus tournaments in this profile."],
 ["Ви увійшли в акаунт","Вы вошли в аккаунт","You are signed in"],
 ["Баланс оновлено","Баланс обновлён","Balance updated"],
 ["Пароль змінено","Пароль изменён","Password changed"],
 ["Ви вийшли з акаунта","Вы вышли из аккаунта","You are signed out"],
 ["Ставку приховано","Ставку скрыто","Bet hidden"],
 ["Номер рахунку скопійовано","Номер счёта скопирован","Account number copied"],
 ["Не вдалося скопіювати","Не удалось скопировать","Could not copy"],
 ["Показати пароль","Показать пароль","Show password"],
 ["Приховати пароль","Скрыть пароль","Hide password"],
 ["Поповнення","Добавление","Deposit"],
 ["Списання","Списание","Withdrawal"],
 ["Особистий профіль Arena Line з віртуальним балансом. Це не акаунт Parik24.","Личный профиль Arena Line с виртуальным балансом. Он не является аккаунтом Parik24.","Arena Line personal profile with a virtual balance. It is not a Parik24 account."],
 ["Профіль синхронізується з серверною копією: баланс, платежі та історія ставок доступні після входу на іншому пристрої.","Профиль синхронизируется с серверной копией: баланс, платежи и история ставок доступны после входа на другом устройстве.","Your profile is synced with the server copy: balance, payments and bet history are available after signing in on another device."],
 ["Матчі та коефіцієнти надходять із лінії. Виплата за ставкою зараховується після підтвердження результату.","Матчи и коэффициенты поступают из линии. Выплата по ставке зачисляется после подтверждения результата.","Matches and odds come from the line. Bet payout is credited after the result is confirmed."],
 ["Коефіцієнт","Коэффициент","Odds"],
 ["Нерозрахована","Нерассчитанная","Unsettled"],
 ["Виграна","Выиграна","Won"],
 ["Програна","Проиграна","Lost"],
 ["Повернення","Возврат","Refund"],
 ["Сума cash-out, €","Сумма cash-out, €","Cash-out amount, €"],
 ["Рахунок 1","Счёт 1","Score 1"],
 ["Рахунок 2","Счёт 2","Score 2"],
 ["Можлива виплата:","Возможная выплата:","Potential payout:"],
 ["Ставку оновлено","Ставка обновлена","Bet updated"],
 ["Ставка не знайдена","Ставка не найдена","Bet not found"],
 ["Некоректна сума ставки","Некорректная сумма ставки","Invalid stake amount"],
 ["У ставки немає результатів","У ставки нет исходов","The bet has no selections"],
 ["Некоректний коефіцієнт","Некорректный коэффициент","Invalid odds"],
 ["Некоректний статус","Некорректный статус","Invalid status"],
 ["Некоректна сума cash-out","Некорректная сумма cash-out","Invalid cash-out amount"],
 ["Недостатньо коштів для зміни ставки","Недостаточно средств для изменения ставки","Insufficient funds to edit the bet"],
 ["Не вдалося синхронізувати пароль","Не удалось синхронизировать пароль","Could not sync password"],
 ["Вкажіть суму з точністю до копійок","Укажите сумму с точностью до копеек","Enter the amount to two decimal places"],
 ["Сума має бути більшою за нуль","Сумма должна быть больше нуля","Amount must be greater than zero"],
 ["Занадто велика сума купона","Слишком большая сумма купона","Bet slip amount is too large"],
 ["Не вдалося прочитати дані профілю","Не удалось прочитать данные профиля","Could not read profile data"],
 ["Неправильна пошта або пароль","Неверная почта или пароль","Incorrect email or password"],
 ["Перевірте адресу електронної пошти","Проверьте адрес почты","Check the email address"],
 ["Пароль має містити щонайменше 8 символів","Пароль должен содержать минимум 8 символов","Password must contain at least 8 characters"],
 ["Вкажіть ім’я та прізвище","Укажите имя и фамилию","Enter first and last name"],
 ["Цей акаунт уже створено. Увійдіть за поштою та паролем.","Этот аккаунт уже создан. Войдите по почте и паролю.","This account already exists. Sign in with your email and password."],
 ["Спочатку увійдіть в акаунт","Сначала войдите в аккаунт","Sign in first"],
 ["Не вдалося створити купон","Не удалось создать купон","Could not create bet slip"],
 ["Мінімальна сума ставки 20 €","Минимальная сумма ставки 20 €","Minimum stake is €20"],
 ["Перевірте купон","Проверьте купон","Check the bet slip"],
 ["Коефіцієнт недоступний","Коэффициент недоступен","Odds unavailable"],
 ["Недостатньо коштів","Недостаточно средств","Insufficient funds"],
 ["Некоректна операція","Некорректная операция","Invalid operation"],
 ["Перевищено ліміт віртуального балансу","Превышен лимит виртуального баланса","Virtual balance limit exceeded"],
 ["Мінімум 8 символів","Минимум 8 символов","Minimum 8 characters"],
 ["Поточний пароль неправильний","Текущий пароль неверен","Current password is incorrect"],
 ["Відновлюємо з’єднання","Восстанавливаем соединение","Reconnecting"],
 ["З’єднання перервано. Відновлюємо лінію…","Соединение прервано. Восстанавливаем линию…","Connection interrupted. Reconnecting to the line…"],
 ["Матчі тимчасово недоступні","Матчи временно недоступны","Matches are temporarily unavailable"],
 ["Ринки матчу","Рынки матча","Match markets"],
 ["Ці результати вже недоступні. Оберіть актуальний коефіцієнт у матчі.","Эти исходы уже недоступны. Выберите актуальный коэффициент в матче.","These selections are no longer available. Choose current odds in the match."],
 ["Коефіцієнт тимчасово недоступний","Коэффициент временно недоступен","Odds are temporarily unavailable"],
 ["Прибрати результат","Убрать исход","Remove selection"],
 ["Коефіцієнти оновлено. Підтвердьте ставку.","Коэффициенты обновлены. Подтвердите ставку.","Odds were updated. Confirm the bet."],
 ["Коефіцієнт змінився. Перевірте купон ще раз.","Коэффициент изменился. Проверьте купон ещё раз.","Odds changed. Check the bet slip again."],
 ["Ставку розраховано. Виплата та історія оновлені.","Ставка рассчитана. Выплата и история обновлены.","Bet settled. Payout and history updated."],
 ["Профіль і баланс","Профиль и баланс","Profile and balance"],
 ["Всі події","Все события","All events"],
 ["Сповіщення про матч","Уведомления о матче","Match notifications"],
 ["В історії джерела немає особистих зустрічей цих команд.","В истории источника нет личных встреч этих команд.","The source has no head-to-head history for these teams."],
 ["Історія поки недоступна","История пока недоступна","History is not available yet"],
 ["Інформація про матч","Информация о матче","Match information"],
 ["Матч завершено","Матч завершён","Match finished"],
 ["Не вдалося створити зображення","Не удалось создать изображение","Could not create image"],
 ["Не вдалося зберегти купон","Не удалось сохранить купон","Could not save bet slip"],
 ["Купон Arena Line","Купон Arena Line","Arena Line bet slip"],
 ["Не вдалося поділитися. Купон можна зберегти зображенням.","Не удалось поделиться. Купон можно сохранить изображением.","Could not share. You can save the bet slip as an image."],
 ["Основні розділи","Основные разделы","Main sections"],
 ["Лінія","Линия","Line"],
 ["Купон","Купон","Bet slip"],
 ["Види спорту","Виды спорта","Sports"],
 ["Ринок","Рынок","Market"],
 ["Головна навігація","Главная навигация","Main navigation"],
 ["Згорнути купон","Свернуть купон","Collapse bet slip"],
 ["Розмір системи","Размер системы","System size"],
 ["Сума ставки, €","Сумма ставки, €","Stake, €"],
 ["Профіль Arena Line","Профиль Arena Line","Arena Line profile"],
 ["Навігація профілю","Навигация профиля","Profile navigation"],
 ["Доступних результатів","Доступных исходов","Available outcomes"],
 ["Виведено","Выведено","Cashed out"],
 ["Редагувати","Редактировать","Edit"],
 ["Загальний коефіцієнт","Общий коэффициент","Total odds"],
 ["Назад","Назад","Back"],
 ["Мої ставки","Мои ставки","My bets"],
];
let language='uk';
try {language=localStorage.getItem('arena-language-v1')||'uk';}catch{}
if(!['uk','ru','en'].includes(language))language='uk';
const lookup=new Map();
for(const values of phrases){if(!Array.isArray(values)||values.length<3)continue;for(const value of values)if(!lookup.has(value))lookup.set(value,values);}
export const getLanguage=()=>language;
export const getLocale=()=>({uk:'uk-UA',ru:'ru-UA',en:'en-GB'})[language];
export function t(value) {
  const text=String(value??''),trim=text.trim(),column={uk:0,ru:1,en:2}[language];
  const exact=lookup.get(trim);
  if(exact)return text.replace(trim,exact[column]);
  const local=(uk,ru,en)=>[uk,ru,en][column];
  const withTail=(uk,ru,en,tail)=>`${local(uk,ru,en)} ${tail}`;
  const englishOrdinal=value=>{
    const n=Number(value),mod100=n%100;
    const suffix=mod100>=11&&mod100<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th';
    return `${n}${suffix}`;
  };
  let result=text.replace(/\b(\d+)\s*[чЧгГ]\b/g,(_,n)=>`${n}${language==='uk'?'Г':language==='ru'?'Ч':'H'}`);
  result=result.replace(/(?:Карта|Map)\s+(\d+)/gi,(_,n)=>`${language==='en'?'Map':'Карта'} ${n}`);
  result=result.replace(/^(?:(?:Точний рахунок|Точный сч[её]т)\s+(?:по\s+карт(?:ах|ам)|за\s+картами)|(?:Correct|Exact)\s+map\s+score)\s+(.+)$/i,(_,tail)=>withTail('Точний рахунок за картами','Точный счёт по картам','Correct map score',tail));
  result=result.replace(/^(?:Точний рахунок|Точный сч[её]т|Correct score|Exact score)\s+(.+)$/i,(_,tail)=>withTail('Точний рахунок','Точный счёт','Correct score',tail));
  result=result.replace(/^(?:Рахунок|Сч[её]т|Score)\s+(.+)$/i,(_,tail)=>withTail('Рахунок','Счёт','Score',tail));
  result=result.replace(/^(?:Фора за картами|Фора по картам|Map handicap)\s+(.+)$/i,(_,tail)=>withTail('Фора за картами','Фора по картам','Map handicap',tail));
  result=result.replace(/^(?:Тотал карт|Total maps)\s+(.+)$/i,(_,tail)=>withTail('Тотал карт','Тотал карт','Total maps',tail));
  result=result.replace(/^(?:Фора|Handicap)\s+(.+)$/i,(_,tail)=>withTail('Фора','Фора','Handicap',tail));
  result=result.replace(/^(?:Тотал|Total)\s+(.+)$/i,(_,tail)=>withTail('Тотал','Тотал','Total',tail));
  result=result.replace(/^(?:Сет|Set)\s+(\d+)$/i,(_,n)=>language==='en'?`Set ${n}`:`Сет ${n}`);
  result=result.replace(/^(?:Період|Период|Period)\s+(\d+)$/i,(_,n)=>withTail('Період','Период','Period',n));
  result=result.replace(/^(\d+)-(?:й|ий)\s+тайм$/i,(_,n)=>language==='en'?`${englishOrdinal(n)} half`:`${n}-й тайм`);
  result=result.replace(/^(\d+)(?:st|nd|rd|th)\s+half$/i,(_,n)=>language==='en'?`${englishOrdinal(n)} half`:`${n}-й тайм`);
  result=result.replace(/^(\d+)\s+доступних\s+результатів$/i,(_,n)=>language==='uk'?`${n} доступних результатів`:language==='ru'?`${n} доступных исходов`:`${n} available outcomes`);
  result=result.replace(/^(\d+)\s+з\s+(\d+)$/i,(_,a,b)=>language==='uk'?`${a} з ${b}`:language==='ru'?`${a} из ${b}`:`${a} of ${b}`);
  result=result.replace(/^Коефіцієнт змінився:\s*(.+)$/i,(_,tail)=>language==='uk'?`Коефіцієнт змінився: ${tail}`:language==='ru'?`Коэффициент изменился: ${tail}`:`Odds changed: ${tail}`);
  result=result.replace(/^Матч завершено\s*·\s*(.+)$/i,(_,tail)=>language==='uk'?`Матч завершено · ${tail}`:language==='ru'?`Матч завершён · ${tail}`:`Match finished · ${tail}`);
  result=result.replace(/^(Менше|Меньше|Under)\s+(.+)$/i,(_,__,tail)=>language==='uk'?`Менше ${tail}`:language==='ru'?`Меньше ${tail}`:`Under ${tail}`);
  result=result.replace(/^(Більше|Больше|Over)\s+(.+)$/i,(_,__,tail)=>language==='uk'?`Більше ${tail}`:language==='ru'?`Больше ${tail}`:`Over ${tail}`);
  if(/ · | — /.test(result))result=result.split(/( · | — )/).map(part=>lookup.get(part)?.[column]||part).join('');
  return result;
}
const originals=new WeakMap();
export function translatePage(root=document.body) {
  const walker=document.createTreeWalker(root,4);let node;
  while((node=walker.nextNode())) {
    if(node.parentElement?.closest('script,style,textarea,[data-no-translate]'))continue;
    const prior=originals.get(node),original=prior&&node.nodeValue===prior.translated?prior.original:node.nodeValue;
    const translated=t(original);originals.set(node,{original,translated});if(node.nodeValue!==translated)node.nodeValue=translated;
  }
  for(const element of root.querySelectorAll('[placeholder],[aria-label],[title]')) for(const attr of ['placeholder','aria-label','title']) {
    if(!element.hasAttribute(attr))continue;
    const value=element.getAttribute(attr),data=originals.get(element)||{},prior=data[attr];
    const original=prior&&value===prior.translated?prior.original:value,translated=t(original);
    data[attr]={original,translated};originals.set(element,data);if(value!==translated)element.setAttribute(attr,translated);
  }
  document.documentElement.lang=language;
}
export function setLanguage(value) {
  if(!['uk','ru','en'].includes(value))return;
  language=value;localStorage.setItem('arena-language-v1',value);
  window.dispatchEvent(new CustomEvent('arena-language-change'));translatePage();
}
export function startTranslations() {
  translatePage();let scheduled=false;
  new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;translatePage();});}).observe(document.body,{childList:true,subtree:true,characterData:true});
}
