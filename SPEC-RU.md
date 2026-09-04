# Спецификация Slapflow

`slapflow` — npm-пакет для декларативного выполнения синхронных и асинхронных действий в упорядоченных цепочках с условиями выполнения, резервными ветками, трассировкой и ограничениями безопасности.

Пакет не привязан к интерфейсу, серверному фреймворку, планировщику или модели предметной области. Приложение регистрирует действия и условия, передаёт контекст и входные данные, а исполнитель возвращает результат выполнения цепочки.

## Поток выполнения

[Посмотреть схему потока выполнения](RUNTIME-FLOW.mmd).

## Публичный API

```ts
import {
  BUILTIN_ACTIONS,
  BUILTIN_CONDITIONS,
  createMemoryTraceSink,
  defineErrorReporter,
  createPubSub,
  PubSub,
  createFlow,
  createWebSocket,
  catchError,
} from 'slapflow'
```

```ts
const flow = createFlow<Context, Patch>({ config: { strategies: {} } }, { context: () => ({}) as Context })
const runner = flow.runner

runner.registerAction('jobs.execute', executeJob)
runner.registerCondition('hasQueue', ({ context }) => context.queue.length > 0)

runner.loadConfig(config)
const result = await runner.run('worker.tick', context, input)
```

## Основные типы

```ts
type Config = {
  version?: 1
  strategies: Record<string, Strategy>
  entrypoints?: Record<string, string>
  guards?: Record<string, ConditionExpression>
}

type ConditionExpression = boolean | [operator: string, ...args: unknown[]] | ['guard', name: string]

type Strategy = {
  fn: string
  props?: Record<string, unknown>
  when?: ConditionExpression
  then?: Next[]
  catch?: Next[]
  mode?: 'sequence' | 'selector' | 'parallel'
  terminal?: boolean
}
```

## Сообщение об ошибках

Исполнитель работает как декларативный конвейер try/catch: действие может вернуть `runtime.fail(...)` или выбросить исключение, стратегия может определить `catch`, а приложение — централизованно сообщать об ошибках через `onError`.

```ts
const reportError = defineErrorReporter({
  report: ({ error, context, input, data, patches, events, trace }) => {
    Sentry.captureException(error.cause ?? error, {
      tags: {
        code: error.code,
        phase: error.stage?.phase,
        strategy: error.stage?.strategy,
        fn: error.stage?.fn,
      },
      extra: { context, input, data, patches, events, trace },
    })
  },
})

const flow = createFlow(
  { config: { strategies: {} } },
  { context: () => ({}) as Context, trace: true, onError: reportError }
)
```

`onError` получает `SlapErrorEvent`:

```ts
type SlapErrorEvent<TContext, TPatch> = {
  error: SlapError
  context: TContext
  input: Input
  data: Record<string, unknown>
  patches: TPatch[]
  events: SlapEvent[]
  trace?: TraceEntry[]
}
```

`SlapError.stage` определяет фазу цепочки:

```ts
type ErrorStage = {
  phase: 'entrypoint' | 'condition' | 'action' | 'catch' | 'limit'
  entrypoint?: string
  strategy?: string
  fn?: string
  mode?: Mode
  step?: number
  depth?: number
}
```

Если ошибка обработана через `catch`, `onError` всё равно вызывается для исходного сбоя, а итоговый `run` может завершиться со статусом `success`.

## Нормализация возврата действия

Возвращаемое значение действия нормализуется в один итог. Соответствие:

| Возврат                                           | Итог                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `undefined` / `null`                              | `success`                                                     |
| `false`                                           | `skipped`                                                     |
| `{ type: 'skip', reason?, data? }`                | `skipped` (селектор пробует следующую ветку)                  |
| `{ type: 'stop', reason?, patch?, events? }`      | `stopped` (цепочка останавливается без ошибки)                |
| `{ type: 'fail', reason?, data?, error? }`        | `failed` (запускается `catch`, затем `onError`)               |
| `{ context?, data?, patch?, events?, continue? }` | `success`; `continue: false` прерывает оставшиеся `then`-цели |

Брошенное исключение трактуется как `fail`. Возврат `false` и `{ type: 'skip' }` эквивалентны.

## Модель реестров

Встроенные элементы живут в двух общих константах — по одной на вид:

```ts
import { BUILTIN_ACTIONS, BUILTIN_CONDITIONS } from 'slapflow'
```

`BUILTIN_ACTIONS` — это readonly-список `[name, action][]`, предварительно заполненный встроенными действиями; `BUILTIN_CONDITIONS` содержит встроенные условия. Каждый исполнитель получает собственный `new Map(BUILTIN_ACTIONS)` / `new Map(BUILTIN_CONDITIONS)`, поэтому регистрации остаются изолированными по исполнителям.

Встроенные элементы неизменяемы: `registerAction` и `registerCondition` отклоняют попытку переопределить встроенное имя.

```ts
runner.registerAction('app.setData', customSetData)
runner.registerCondition('hasQueue', hasItems)
```

Проверка конфигурации обращается к реестрам через минимальный контракт `has(name)`.

## Встроенные действия

| Действие        | Props                                                                                                                                              | Описание                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `core.noop`     | —                                                                                                                                                  | Успешно завершается, не изменяя состояние runtime.                                                                  |
| `core.stop`     | `reason?`                                                                                                                                          | Останавливает запуск с необязательной причиной.                                                                     |
| `core.fail`     | `reason?`, `data?`                                                                                                                                 | Завершает текущую стратегию ошибкой с необязательной причиной и данными ошибки.                                     |
| `core.fetch`    | **`url`**, `method?`, `headers?`, `body?`, `credentials?`, `response?`, `dataPath?`, `contextPath?`, `acceptStatuses?`, `retryStatuses?`, `retry?` | Загружает данные с отменой, разбором ответа, контролем статусов и retry backoff.                                    |
| `core.loop`     | `duration?`, `max?`, `immediate?`                                                                                                                  | Повторяет ветку `then` по интервалу до отмены или достижения лимита итераций.                                       |
| `core.sequence` | —                                                                                                                                                  | Выполняет цели `then` по порядку.                                                                                   |
| `core.selector` | —                                                                                                                                                  | Выполняет цели `then` до первого успешного результата или остановки.                                                |
| `core.parallel` | —                                                                                                                                                  | Выполняет цели `then` параллельно в изолированных ветках context и data.                                            |
| `core.set`      | **`path`**, `value?`, `data?`                                                                                                                      | Записывает `value` во вложенный путь context; необязательный `data` объединяется с runtime data.                    |
| `core.setData`  | **`path`**, `value?`, `data?`                                                                                                                      | **Устарело.** Записывает `value` в runtime data; в прикладном действии используйте `runtime.data.set(path, value)`. |
| `core.emit`     | **`type`**, `payload?`                                                                                                                             | Добавляет событие в результат запуска.                                                                              |
| `core.patch`    | **`patch`**                                                                                                                                        | Добавляет patch в результат запуска.                                                                                |
| `core.delay`    | `ms?`                                                                                                                                              | Ждёт указанное время или отмену запуска.                                                                            |

Жирным отмечены обязательные props; `?` обозначает необязательные. Все имена в этой колонке являются полями объекта `props` стратегии.

`core.loop` выполняет ветку `then` каждые `props.duration` миллисекунд до отмены запуска или завершения `props.max` итераций. Максимум по умолчанию — `999`: один из стандартных `maxStepCount: 1000` шагов расходуется на сам loop action. Значение `max: -1` отключает ограничение количества итераций, но не safety limits runner-а. Ноль, значения меньше `-1`, `NaN` и бесконечность заменяются значением по умолчанию. Если `props.immediate` равен `true`, первая итерация выполняется сразу, учитывается в `max` и не ждёт первого интервала. Пересекающиеся итерации пропускаются. При ошибке итерации выполняется `catch`; после успешного `catch` цикл продолжается.
Вложенные стратегии `core.loop` запрещены, включая транзитивные ссылки через `then` или `catch`. Соседние циклы в отдельных ветках разрешены.

Экшены могут выполнять собственные настроенные ветки через `runtime.executeThen()` и `runtime.executeCatch()`. `executeThen()` учитывает `mode` стратегии, поэтому управляющие экшены вроде `core.loop` могут компоноваться с выполнением `sequence`, `selector` и `parallel`, не обращаясь к внутренностям runner.

`core.set` записывает вложенное значение контекста через `runtime.set`. `core.setData` сохранён для совместимости; новые прикладные действия должны записывать временные данные цепочки через `runtime.data.set(path, value)`.

`core.fetch` использует нативный `fetch` с signal текущего запуска. Свойство `response` выбирает `json`, `text`, `blob`, `arrayBuffer` или `none`; успешный ответ нормализуется в `{ status, ok, headers, body }` и может быть записан по `dataPath` или `contextPath`. `acceptStatuses` переопределяет стандартную проверку успеха через `Response.ok`. `credentials` принимает `include`, `same-origin` или `omit` и передаётся в нативный `fetch`. CORS, preflight-запросы, правила SameSite cookie и политика cookie сервера остаются ответственностью браузера и сервера. `retry` принимает `initialDelay`, `maxDelay`, `multiplier`, `jitter` и `maxAttempts`; `retryStatuses` переопределяет стандартный набор повторяемых статусов. По умолчанию выполняются две повторные попытки для сетевых ошибок и статусов `408`, `425`, `429` и `5xx`. Ошибки разбора response body не повторяются. Отменённый запрос или retry возвращает `skip`. Ретраи предназначены для body, который можно безопасно повторно отправить.

## Встроенные условия

| Условие         | Описание                                                                          | Пример                                                                          |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `and`           | Совпадает, когда совпали все вложенные условия.                                   | `['and', ['typeIs', '$input.id', 'string'], ['notEmpty', '$input.id']]`         |
| `or`            | Совпадает, когда совпало хотя бы одно вложенное условие.                          | `['or', ['eq', '$context.status', 'ready'], ['eq', '$context.status', 'idle']]` |
| `not`           | Инвертирует вложенное условие.                                                    | `['not', ['truthy', '$context.disabled']]`                                      |
| `eq`            | Сравнивает два значения через `Object.is`.                                        | `['eq', '$context.status', 'ready']`                                            |
| `neq`           | Совпадает, когда `Object.is` не считает значения равными.                         | `['neq', '$context.status', 'failed']`                                          |
| `gt`            | Численно сравнивает значения через `>`.                                           | `['gt', '$context.count', 0]`                                                   |
| `gte`           | Численно сравнивает значения через `>=`.                                          | `['gte', '$context.count', 1]`                                                  |
| `lt`            | Численно сравнивает значения через `<`.                                           | `['lt', '$context.count', 100]`                                                 |
| `lte`           | Численно сравнивает значения через `<=`.                                          | `['lte', '$context.count', 99]`                                                 |
| `truthy`        | Применяет JavaScript truthiness.                                                  | `['truthy', '$context.enabled']`                                                |
| `falsy`         | Применяет JavaScript falsiness.                                                   | `['falsy', '$context.disabled']`                                                |
| `exists`        | Совпадает для значений, отличных от `null` и `undefined`.                         | `['exists', '$data.response']`                                                  |
| `missing`       | Совпадает для `null` или `undefined`.                                             | `['missing', '$data.error']`                                                    |
| `empty`         | Совпадает для пустых строк, массивов, map, set, объектов и nullish-значений.      | `['empty', '$context.items']`                                                   |
| `notEmpty`      | Совпадает для поддерживаемых значений с размером больше нуля.                     | `['notEmpty', '$context.items']`                                                |
| `includes`      | Проверяет вхождение в строки, массивы и set.                                      | `['includes', ['parts', 'food'], '$input.resource']`                            |
| `typeIs`        | Совпадает с `string`, `number`, `finite-number`, `boolean`, `array` или `record`. | `['typeIs', '$input.amount', 'finite-number']`                                  |
| `changed`       | Совпадает, когда текущее и предыдущее значения различаются по `Object.is`.        | `['changed', '$context.current', '$context.previous']`                          |
| `cooldownReady` | Совпадает, когда предыдущей метки времени нет или задержка истекла.               | `['cooldownReady', '$context.now', '$context.lastAt', 1000]`                    |

## Пример конфигурации

```ts
export const config = {
  version: 1,
  entrypoints: {
    'worker.tick': 'worker.tick',
  },
  strategies: {
    'worker.tick': {
      fn: 'core.selector',
      mode: 'selector',
      then: ['worker.pickQueuedJob', 'worker.idle'],
    },
    'worker.pickQueuedJob': {
      fn: 'jobs.findNext',
      when: ['and', ['eq', '$context.worker.state', 'idle'], ['gt', '$context.worker.queueSize', 0]],
      then: ['jobs.reserve', 'jobs.execute'],
    },
    'worker.idle': {
      fn: 'core.noop',
    },
  },
}
```

## Режимы выполнения

`sequence` выполняет цели `then` по порядку.

`selector` выполняет цели `then` до первого успешного или остановленного шага. `skip` означает «попробовать следующий вариант».

`parallel` запускает цели `then` независимо. Простые объекты и массивы контекста и runtime data копируются для каждой ветки; инфраструктурные значения вроде функций, DOM-узлов и экземпляров классов остаются ссылками. Safety limits, включая `maxStepCount`, остаются общими для всего запуска. Полученные патчи и события возвращаются вызывающей стороне; исполнитель их не применяет.

### Прерывание цепочки

Не-`success` итог шага меняет дальнейшее поведение в зависимости от режима:

| Итог      | `sequence`            | `selector`              |
| --------- | --------------------- | ----------------------- |
| `skipped` | **прерывает остаток** | пробует следующую ветку |

`sequence` — режим по умолчанию, и он прерывает оставшиеся `then`-цели на _любом_ не-`success` (`skipped`, `stopped`, `failed`) — не только на сбое. Условный шаг внутри последовательности — это, таким образом, скрытый ранний выход для всего остатка. Если пропуск шага не должен рвать цепочку, заверните его в селектор с запасным `core.noop`.

`terminal: true` останавливает `then`-цепочку после этой стратегии даже при `success`; `continue: false` в `ActionSuccess` даёт тот же эффект.

## Вспомогательные средства среды выполнения

```ts
type Runtime = {
  get(path: string): unknown
  set(path: string, value: unknown): void
  data: {
    get(path: string): unknown
    set(path: string, value: unknown): void
  }
  variables?: {
    get(path: string): unknown
  }
  /** @deprecated Используйте runtime.data.get(path). */
  getData(path: string): unknown
  /** @deprecated Используйте runtime.data.set(path, value). */
  setData(path: string, value: unknown): void
  resolve(value: unknown): unknown
  signal: AbortSignal
  executeThen(): Promise<RuntimeBranchResult>
  executeCatch(): Promise<RuntimeBranchResult | undefined>
  emit(event: SlapEvent): void
  patch(patch: unknown): void
  stop(reason?: string): ActionStop<unknown>
  fail(reason?: string, data?: Record<string, unknown>): ActionFail
}
```

`runtime.get` и `runtime.set` читают и записывают вложенные значения контекста. `runtime.data.get` и `runtime.data.set` читают и записывают временные данные цепочки.

`runtime.getData` и `runtime.setData` сохранены как устаревшие алиасы для совместимости и при вызове выводят предупреждение в консоль.

`runtime.variables.get` читает неизменяемые runtime-переменные. `runtime.resolve` разрешает ссылки `$context.*`, `$data.*`, `$input.*` и неизменяемые значения `$variables.*`. Он также рекурсивно вычисляет объекты `$expression` и `$template`, используя операторы выражений, зарегистрированные в опциях runner. В `$template` для совместимости `{{ path }}` читает runtime data; `{{ data.path }}`, `{{ context.path }}` и `{{ input.path }}` явно выбирают источник.

Чтение и запись путей во время выполнения реализованы непосредственно через `objwalk`.

## Guards

Переиспользуемые выражения `when` живут в карте `guards` на `Config` и подключаются к `when` стратегии (или шага `then`/`catch`) узлом `['guard', имя]`:

```ts
const config = {
  guards: {
    'has-colony': ['truthy', '$data.colonyId'],
    'same-colony': ['eq', '$input.colonyId', '$context.colonyId'],
  },
  strategies: {
    'colony.join': {
      fn: 'colony.join',
      when: ['and', ['guard', 'has-colony'], ['not', ['guard', 'same-colony']]],
    },
  },
}
```

Guard — это обычное `ConditionExpression`, и сам может ссылаться на другие guards. Ссылки раскрываются один раз при загрузке конфигурации (`loadConfig`), до того как рантайм что-либо вычисляет, поэтому рантайм никогда не видит узел `['guard', ...]`. Guards раскрываются рекурсивно через `and`/`or`/`not`; ссылка на несуществующий guard даёт ошибку валидации `GUARD_NOT_FOUND`, а взаимные ссылки — `GUARD_CYCLE`. Значение guard должно быть выражением-условием, а не строкой `$path`.

Guards существуют, чтобы критерий истинности жил в одном месте, а не дублировался по стратегиям; это вычисляемые данные, а не зарегистрированный код (в отличие от `registerCondition`, который регистрирует функцию-оператор).

## Проверка конфигурации

`validateConfig` проверяет:

- неизвестные действия через `actionsRegistry.has(fn)`;
- неизвестные операторы условий через `conditionsRegistry.has(operator)`;
- отсутствующие стратегии в `then`, `catch` и `entrypoints`;
- недопустимые режимы;
- недопустимые ссылки на пути;
- циклы без завершающего шага;
- ссылки на guards (`GUARD_NOT_FOUND`, `GUARD_CYCLE`, `GUARD_INVALID`).

## Трассировка

Записи трассировки содержат:

- шаг и глубину (`step`/`depth`);
- стратегию, функцию и режим (`strategy`/`fn`/`mode`);
- статус (`status`);
- входные данные (`input`);
- свойства (`props`);
- данные до и после (`dataBefore`/`dataAfter`);
- длительность (`durationMs`);
- причину (`reason`).

Трассировка не хранит полный снимок контекста.

## Шина публикации и подписки

`PubSub` — локальная для процесса шина событий-одиночка. Для изолированных сред выполнения используйте `createPubSub`.

```ts
type AppEvents = {
  'auth.signed-in': { userId: string }
}

const bus = createPubSub<AppEvents>()
const unsubscribe = bus.on('auth.signed-in', ({ parsed, serialized }) => {
  console.log(parsed.userId)
  socket.send(serialized)
})

bus.emit('auth.signed-in', { userId: 'ada' }, { origin: 'api' })
unsubscribe()
```

```ts
type Bus<TEvents extends object = Record<string, unknown>> = {
  on: {
    <TEvent extends keyof TEvents>(event: TEvent, handler: (event: BusEvent<TEvents[TEvent]>) => void): () => void
    (event: EventPattern, handler: (event: BusEvent<unknown>) => void): () => void
  }
  off: {
    <TEvent extends keyof TEvents>(event: TEvent, handler?: (event: BusEvent<TEvents[TEvent]>) => void): void
    (event: EventPattern, handler?: (event: BusEvent<unknown>) => void): void
  }
  emit<TEvent extends keyof TEvents>(
    topic: TEvent,
    payload: TEvents[TEvent],
    options?: { origin?: string }
  ): BusEvent<TEvents[TEvent]>
}

type EventPattern = `${string}*${string}`

type BusEvent<TPayload> = {
  id: string
  topic: string
  occurredAt: number
  origin?: string
  parsed: TPayload
  serialized: string
}
```

`emit` создаёт конверт и сериализует полезную нагрузку один раз до запуска подписчиков. Идентификаторы событий — непрозрачные 12-символьные буквенно-цифровые runtime-ID для корреляции и подавления эха. Они не криптографически стойкие: не используйте их для access token, подписей, публичных ссылок или иных security-sensitive задач. `on` возвращает функцию отписки. `off(event, handler)` удаляет один обработчик, а `off(event)` очищает канал. Ошибка одного подписчика не блокирует остальных; `createPubSub({ onError })` получает ошибку и исходное событие. При ошибке сериализации шина передаёт `{ error }` в качестве `parsed` и тело ошибки в качестве `serialized`, после чего вызывает `onError` с исходной причиной.

### Подписка по шаблону

На тему можно подписаться по шаблону, где `*` соответствует ровно одному сегменту, разделённому точкой. Шаблонный символ не пересекает границу `.`.

```ts
bus.on('hub.user.*', ({ parsed }) => {}) // hub.user.created, hub.user.deleted
bus.on('hub.*.created', ({ parsed }) => {}) // hub.user.created, hub.team.created
bus.on('hub.*.export', ({ parsed }) => {}) // НЕ hub.user.audit.export (один сегмент)
```

Подписки с точным именем остаются O(1); шаблоны обрабатываются отдельно, поэтому регистрации без `*` не несут накладных затрат на сравнение. Обработчик шаблона получает `parsed` как `unknown` — сужайте тип перед использованием. Шаблоны работают в `bus.on`/`bus.off`.

## Поток

`createFlow` объединяет конфигурацию, действия, условия, поставщик контекста и привязки событий. Функция создаёт исполнитель (доступный через `flow.runner`) и поддерживает жизненный цикл `start`/`stop`.

```ts
type Events = {
  'form.submit': { email: string }
}

const flow = createFlow<Context, Patch, Events>(
  {
    actions: { 'form.save': saveForm },
    conditions: { allowed: isAllowed },
    events: { '[bus] form.submit': { entrypoint: 'form.submit' } },
    config,
  },
  { bus, context: () => appStore.getState() }
)

const started = flow.start()
flow.stop()
```

Привязка `[bus] <event-name>` запускает `entrypoint` из `config.entrypoints`. Полезная нагрузка события должна быть объектом и передаётся исполнителю как `input`. Контекст считывается для каждого события, поэтому поставщик контекста возвращает актуальное состояние.

```ts
type StartResult = {
  active: string[]
  inactive: Array<{ binding: string; reason: 'unsupported-source' }>
  validation: ValidationResult
}
```

`start()` регистрирует действия и условия, проверяет и загружает конфигурацию. Если проверка завершилась ошибкой, привязки не устанавливаются. Повторный вызов `start()` заменяет существующие привязки. `stop()` освобождает только подписки, принадлежащие текущему поведению.

`onRunnerError` в `FlowOptions` вызывается только тогда, когда итоговый `RunResult.status === 'failed'`. Колбэк получает `error`, `result`, `binding`, `entrypoint`, `runId` и необязательный `key`. Ошибка, обработанная стратегией через `catch`, не вызывает `onRunnerError`.

### Конкурентное выполнение

Каждая привязка поддерживает `parallel`, `latest`, `queue` и `drop`. Режим по умолчанию — `parallel`. Управление конкурентностью действует в пределах одной привязки и линии; `key(payload)` создаёт независимые линии.

```ts
type ConcurrencyOptions<TPayload> = {
  mode?: 'parallel' | 'latest' | 'queue' | 'drop'
  key?: (payload: TPayload) => string
  maxQueueSize?: number
  overflow?: 'drop-oldest' | 'drop-newest'
}
```

Параметры задаются глобально в `createFlow` и могут быть переопределены привязкой. Размер `queue` ограничен параметром `maxQueueSize`, который по умолчанию равен `50`. При переполнении Slapflow публикует `slapflow.queue.overflow` и `slapflow.run.dropped`.

`ActionArgs` и `Runtime` содержат `signal: AbortSignal`. Режим `latest` прерывает предыдущий запуск в той же линии. `flow.stop({ force: true })` прерывает все активные запуски; обычный `stop()` удаляет привязки, но не отменяет выполняющиеся действия. Прерывание является кооперативным: действие использует сигнал для запросов, таймеров и собственной асинхронной работы.

Диагностика жизненного цикла публикуется через настроенную шину:

- `slapflow.run.started`;
- `slapflow.run.finished`;
- `slapflow.run.failed`;
- `slapflow.run.cancelled`;
- `slapflow.run.dropped`;
- `slapflow.queue.overflow`.

### DOM-привязки

Ключ DOM-привязки имеет формат `[dom] <css-selector>:<event>`. Slapflow устанавливает делегированный слушатель на `options.root` или `document`. В среде без DOM привязка добавляется в `inactive` с причиной `dom-unavailable`.

```ts
'[dom] .app-button[type="submit"]:click': {
  entrypoint: 'form.submit',
  options: {
    preventDefault: true,
    stopPropagation: false,
    capture: false,
    once: false,
    concurrency: { mode: 'drop' },
    input: ({ event, element, defaultInput }) => defaultInput,
  },
}
```

`defaultInput` имеет тип `{ type, value?, dataset, form? }`. `dataset` содержит все атрибуты `data-*` совпавшего элемента в виде ключей camelCase. `form` строится по ближайшему элементу `<form>`; повторяющиеся поля формы превращаются в массивы, а `File` остаётся `File`. Для `submit` значение `preventDefault` по умолчанию равно `true`; для остальных событий оно и `stopPropagation` по умолчанию равны `false`.

### WebSocket-клиент

`createWebSocket` открывает нативный `WebSocket` по `url` и проксирует каждое событие сокета в шину. Формат провода не предполагается — каждое событие отправляется с фиксированной темой и конвертом, где `parsed` содержит сырую полезную нагрузку.

```ts
const socket = createWebSocket({
  url,
  bus,
  origin: 'client',
})

socket.start()
```

```ts
bus.on('message', ({ parsed }) => {}) // parsed = сырое сообщение (JSON-декодированное, когда возможно)
bus.on('open', ({ parsed }) => {}) // { url }
bus.on('close', ({ parsed }) => {}) // { code, reason }
bus.on('error', ({ parsed }) => {}) // { error }
```

События сокета приходят с темой `open`, `message`, `close` или `error`. Полезная нагрузка `message` JSON-декодируется в `parsed`, если валидна, иначе остаётся сырой строкой. Фильтрация тем — забота потребителя: внутри клиента ничего не разрешается и не отклоняется. `reconnect` принимает `initialDelay`, `maxDelay`, `multiplier`, `jitter` и `maxAttempts`; без `maxAttempts` повторы идут бесконечно. `start`, `stop`, `reconnect` и `status` управляют жизненным циклом; статус — одно из `idle`, `connecting`, `connected`, `reconnecting` или `stopped`.

`createWS` помечен как deprecated и будет удалён; мигрируйте на `createWebSocket`.

## Ограничения безопасности

Значения по умолчанию:

- `maxStepCount`: `1000`
- `maxDepth`: `32`
- `timeout`: `0`
- `trace`: `false`

Нарушения ограничений возвращаются как неуспешные результаты с кодами `MAX_STEPS`, `MAX_DEPTH` и `TIMEOUT`.

Значение `-1` для `maxStepCount` или `maxDepth` отключает соответствующую проверку. Валидация возвращает предупреждение `LIMIT_DISABLED`, поскольку неограниченный запуск может выполняться бесконечно, а неограниченная вложенность — исчерпать стек вызовов.
