# CFB — поведение цепочек функций

Когда один и тот же сценарий запускается из формы, HTTP API, фоновой задачи или WebSocket-сообщения, его логика быстро расползается по обработчикам и сервисам. CFB помогает собрать её в одном явном месте — в цепочке обычных TypeScript-функций.

[![Размер бандла](https://img.shields.io/bundlephobia/minzip/chain-functions-behavior?label=%D1%80%D0%B0%D0%B7%D0%BC%D0%B5%D1%80%20%D0%B1%D0%B0%D0%BD%D0%B4%D0%BB%D0%B0)](https://bundlephobia.com/package/chain-functions-behavior)
[![Безопасность Socket](https://socket.dev/api/badge/npm/package/chain-functions-behavior/1.6.1)](https://socket.dev/npm/package/chain-functions-behavior/overview/1.6.1)

CFB берёт на себя порядок выполнения, конкурентность, отмену и диагностику. Состояние предметной области и побочные эффекты по-прежнему остаются в вашем приложении.

## Когда он пригодится

- **Когда важен сам сценарий, а не инфраструктура вокруг него.** Цепочка показывает бизнес-поток целиком, вместо того чтобы прятать его среди UI-обработчиков и транспортного кода.
- **Когда сценарий хочется проверить отдельно от приложения.** Передайте контекст и событие снаружи: действия и условия остаются обычными TypeScript-функциями.
- **Когда асинхронность должна быть предсказуемой.** Для источника событий выберите `parallel`, `latest`, `queue` или `drop`; при необходимости действие получит `AbortSignal` для отмены.
- **Когда один поток нужен в нескольких местах.** Одну и ту же цепочку можно запускать из типизированной шины, DOM-события, API-колбэка, таймера, воркера или WebSocket-сообщения.

## Установка

```bash
npm install chain-functions-behavior
```

## Быстрый старт

Пример обрабатывает отправку заказа из типизированной шины событий. Режим `latest` отменит предыдущую отправку того же заказа, когда придёт новое событие.

```ts
import { createChainBehavior, createPubSubBehavior } from 'chain-functions-behavior'

type Context = {
  orders: Map<string, { id: string; status: 'draft' | 'submitted' }>
}

type Events = {
  'order.submit': { orderId: string }
}

const bus = createPubSubBehavior<Events>()
const context: Context = {
  orders: new Map([['order-1', { id: 'order-1', status: 'draft' }]]),
}

const behavior = createChainBehavior<Context, unknown, Events>(
  {
    events: {
      '[bus] order.submit': {
        entrypoint: 'order.submit',
        options: {
          concurrency: {
            mode: 'latest',
            key: ({ orderId }) => orderId,
          },
        },
      },
    },
    actions: {
      'order.submit': ({ context, input }) => {
        const order = context.orders.get(input.orderId as string)

        if (order) {
          order.status = 'submitted'
        }
      },
    },
    config: {
      entrypoints: { 'order.submit': 'order.submit' },
      strategies: { 'order.submit': { fn: 'order.submit' } },
    },
  },
  { bus, context }
)

behavior.start()
bus.emit('order.submit', { orderId: 'order-1' }, { origin: 'api' })
```

## Загрузка данных с отменой и ретраями

`core.fetch` использует `AbortSignal` запуска, повторяет временные ошибки и передаёт ответ следующей стратегии, не привязывая сценарий к конкретному HTTP-клиенту.

```ts
const config = {
  strategies: {
    'catalog.load': {
      fn: 'core.fetch',
      props: {
        url: '/api/catalog',
        response: 'json',
        dataPath: 'catalogResponse',
        retry: { maxAttempts: 2, initialDelay: 250, maxDelay: 1_000 },
      },
      then: ['catalog.apply'],
    },
    'catalog.apply': { fn: 'catalog.apply' },
  },
}

const applyCatalog = ({ runtime }) => {
  const { body } = runtime.data.get('catalogResponse')

  // Обновите состояние приложения данными из body.
}
```

## Ветвление со сложными условиями

Каждая цель в `then` и `catch` может иметь собственное условие. Встроенные условия комбинируются через `and`, `or` и `not`, поэтому ветвление остаётся в графе:

```ts
const config = {
  strategies: {
    'catalog.load': {
      fn: 'core.fetch',
      props: {
        url: '/api/catalog',
        response: 'json',
        dataPath: 'catalogResponse',
      },
      then: [
        {
          strategy: 'catalog.apply',
          when: [
            'and',
            ['typeIs', '$data.catalogResponse.body', 'record'],
            ['typeIs', '$data.catalogResponse.body.items', 'array'],
            ['not', ['empty', '$data.catalogResponse.body.items']],
          ],
        },
        {
          strategy: 'catalog.showEmpty',
          when: ['or', ['missing', '$data.catalogResponse.body.items'], ['empty', '$data.catalogResponse.body.items']],
        },
      ],
      catch: [
        {
          strategy: 'catalog.queueRetry',
          when: ['and', ['falsy', '$context.network.online'], ['includes', ['startup', 'refresh'], '$input.source']],
        },
        {
          strategy: 'catalog.showError',
          when: ['or', ['truthy', '$context.network.online'], ['eq', '$input.source', 'manual']],
        },
      ],
    },
    'catalog.apply': { fn: 'catalog.apply' },
    'catalog.showEmpty': { fn: 'catalog.showEmpty' },
    'catalog.queueRetry': { fn: 'catalog.queueRetry' },
    'catalog.showError': { fn: 'catalog.showError' },
  },
}
```

[Посмотреть схему выполнения](examples/compound-conditions.mmd).

## Что даёт CFB

- Декларативные стратегии, условия, ветки обработки ошибок и точки входа.
- Большой набор [встроенных условий](SPEC-RU.md#встроенные-условия) для сравнений, проверки типов, коллекций и составной логики.
- Типизированные PubSub-привязки и делегированные DOM-привязки.
- Режимы `parallel`, `latest`, `queue` и `drop` с отдельными линиями для разных сущностей.
- WebSocket-мост для передачи выбранных событий шины.
- `core.fetch` с разбором ответа, отменой и retry backoff.
- Нормализованный результат, трассировку выполнения, проверку конфигурации и диагностические события вроде `cfb.run.started` и `cfb.run.failed`.
- Runtime-переменные для значений конфигурации, шаблонов и выражений.

## Дальше

- Посмотрите на запускаемый [клиент-серверный пример Todo app](examples/todo-app): форма отправляет запрос серверному CFB runtime для валидации и сохранения в памяти.
- Полный контракт API, встроенные действия и условия, выражения, валидация, ограничения безопасности, транспорт и жизненный цикл описаны в [спецификации](SPEC-RU.md).
- English documentation: [README.md](README.md) and [SPEC.md](SPEC.md).

## Разработка

```bash
npm test
npm run build
npm run pack:check
```
