# Effect Patterns Migration Guide

## Python to Effect TypeScript Pattern Mapping

This guide provides comprehensive pattern translations from Python async/await and Pydantic patterns to Effect TypeScript equivalents.

## Core Concepts Mapping

### Async/Await → Effect

#### Python Async Function
```python
async def fetch_dom(session_id: str) -> DOMNode:
    try:
        result = await cdp_client.send("DOM.getDocument", {"depth": -1})
        return parse_dom(result)
    except Exception as e:
        logger.error(f"Failed to fetch DOM: {e}")
        raise
```

#### Effect Equivalent
```typescript
const fetchDOM = (sessionId: string): Effect.Effect<DOMNode, DOMError> =>
  pipe(
    CDPClient.send("DOM.getDocument", { depth: -1 }),
    Effect.map(parseDOM),
    Effect.tapError((error) =>
      Effect.log(`Failed to fetch DOM: ${error}`)
    )
  )
```

### Error Handling Patterns

#### Python Try-Except
```python
async def safe_click(element_id: str) -> bool:
    try:
        await browser.click(element_id)
        return True
    except TimeoutError:
        logger.warning("Click timeout")
        return False
    except Exception as e:
        logger.error(f"Click failed: {e}")
        return False
```

#### Effect Error Handling
```typescript
const safeClick = (elementId: string): Effect.Effect<boolean> =>
  pipe(
    Browser.click(elementId),
    Effect.map(() => true),
    Effect.catchTag("TimeoutError", () =>
      pipe(
        Effect.log("Click timeout"),
        Effect.map(() => false)
      )
    ),
    Effect.catchAll((error) =>
      pipe(
        Effect.log(`Click failed: ${error}`),
        Effect.succeed(false)
      )
    )
  )
```

## Model Definition Patterns

### Pydantic → Effect Schema

#### Python Pydantic Model
```python
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime

class BrowserAction(BaseModel):
    action_type: str = Field(..., pattern="^(click|type|scroll)$")
    target: str
    value: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: dict[str, Any] = Field(default_factory=dict)
    
    @field_validator('target')
    def validate_target(cls, v):
        if not v or len(v) < 1:
            raise ValueError("Target cannot be empty")
        return v
    
    @property
    def is_input_action(self) -> bool:
        return self.action_type == "type"
```

#### Effect Schema Equivalent
```typescript
import { Schema as S, ParseResult } from "@effect/schema"
import { Effect, pipe } from "effect"

// Define custom validators
const nonEmptyString = pipe(
  S.String,
  S.filter((s) => s.length > 0, {
    message: () => "Target cannot be empty"
  })
)

// Define the schema
const BrowserAction = S.Struct({
  actionType: S.Literal("click", "type", "scroll"),
  target: nonEmptyString,
  value: S.optional(S.String),
  timestamp: S.optional(S.Date, { default: () => new Date() }),
  metadata: S.optional(
    S.Record(S.String, S.Unknown),
    { default: () => ({}) }
  )
}).pipe(
  S.attachPropertySignature("isInputAction", S.Boolean),
  S.transform(
    S.Struct({
      actionType: S.Literal("click", "type", "scroll"),
      target: S.String,
      value: S.optional(S.String),
      timestamp: S.Date,
      metadata: S.Record(S.String, S.Unknown),
      isInputAction: S.Boolean
    }),
    {
      decode: (input) => ({
        ...input,
        isInputAction: input.actionType === "type"
      }),
      encode: ({ isInputAction, ...rest }) => rest
    }
  )
)

// Type inference
type BrowserAction = S.Schema.Type<typeof BrowserAction>

// Usage
const parseAction = S.decode(BrowserAction)
```

## Service Pattern Translation

### Python Class-Based Service
```python
class DOMService:
    def __init__(self, cdp_client: CDPClient, config: Config):
        self.cdp = cdp_client
        self.config = config
        self._cache = {}
    
    async def get_dom_tree(self, session_id: str) -> DOMNode:
        if session_id in self._cache:
            return self._cache[session_id]
        
        result = await self.cdp.send("DOM.getDocument", {
            "depth": -1,
            "pierce": True
        }, session_id=session_id)
        
        tree = self._parse_dom(result)
        self._cache[session_id] = tree
        return tree
    
    def _parse_dom(self, raw: dict) -> DOMNode:
        # Parsing logic
        pass
```

#### Effect Service Pattern
```typescript
import { Context, Effect, Layer, Ref, pipe } from "effect"

// Service interface definition
class DOMService extends Context.Tag("DOMService")<
  DOMService,
  {
    getDOMTree: (sessionId: string) => Effect.Effect<DOMNode, DOMError>
  }
>() {}

// Service implementation
const DOMServiceLive = Layer.effect(
  DOMService,
  Effect.gen(function* () {
    // Dependencies
    const cdp = yield* CDPClient
    const config = yield* Config
    
    // Private state
    const cache = yield* Ref.make<Map<string, DOMNode>>(new Map())
    
    // Private methods
    const parseDOM = (raw: unknown): Effect.Effect<DOMNode> =>
      pipe(
        raw,
        S.decode(DOMNodeSchema),
        Effect.mapError((e) => new DOMError({ cause: e }))
      )
    
    // Public interface
    return DOMService.of({
      getDOMTree: (sessionId: string) =>
        Effect.gen(function* () {
          // Check cache
          const cached = yield* Ref.get(cache)
          const existing = cached.get(sessionId)
          if (existing) return existing
          
          // Fetch new
          const result = yield* cdp.send("DOM.getDocument", {
            depth: -1,
            pierce: true
          })
          
          const tree = yield* parseDOM(result)
          
          // Update cache
          yield* Ref.update(cache, (map) =>
            new Map(map).set(sessionId, tree)
          )
          
          return tree
        })
    })
  })
)
```

## Event Handling Patterns

### Python Event Bus
```python
from bubus import EventBus, Event

class ClickEvent(Event):
    element_id: str
    coordinates: tuple[int, int]

bus = EventBus()

@bus.on(ClickEvent)
async def handle_click(event: ClickEvent):
    print(f"Clicked {event.element_id} at {event.coordinates}")

# Publishing
await bus.publish(ClickEvent(
    element_id="button-1",
    coordinates=(100, 200)
))
```

#### Effect PubSub/Stream Pattern
```typescript
import { PubSub, Stream, Effect, pipe } from "effect"

// Event definitions
interface ClickEvent {
  readonly _tag: "ClickEvent"
  readonly elementId: string
  readonly coordinates: readonly [number, number]
}

// Event bus service
class EventBus extends Context.Tag("EventBus")<
  EventBus,
  {
    publish: <E extends BrowserEvent>(event: E) => Effect.Effect<void>
    subscribe: <E extends BrowserEvent>(
      tag: E["_tag"]
    ) => Stream.Stream<E>
  }
>() {}

const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<BrowserEvent>()
    
    return {
      publish: (event) => PubSub.publish(pubsub, event),
      
      subscribe: (tag) =>
        pipe(
          Stream.fromPubSub(pubsub),
          Stream.filter((event): event is any => event._tag === tag)
        )
    }
  })
)

// Usage
const handleClicks = Effect.gen(function* () {
  const eventBus = yield* EventBus
  
  yield* pipe(
    eventBus.subscribe("ClickEvent"),
    Stream.tap((event) =>
      Effect.log(`Clicked ${event.elementId} at ${event.coordinates}`)
    ),
    Stream.runDrain
  )
})

// Publishing
const publishClick = Effect.gen(function* () {
  const eventBus = yield* EventBus
  
  yield* eventBus.publish({
    _tag: "ClickEvent",
    elementId: "button-1",
    coordinates: [100, 200] as const
  })
})
```

## Concurrency Patterns

### Python AsyncIO Concurrency
```python
import asyncio
from typing import List

async def process_elements(elements: List[Element]) -> List[Result]:
    tasks = [process_single(el) for el in elements]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    successful = []
    for r in results:
        if not isinstance(r, Exception):
            successful.append(r)
    
    return successful

async def with_timeout(coro, timeout: float):
    try:
        return await asyncio.wait_for(coro, timeout)
    except asyncio.TimeoutError:
        return None
```

#### Effect Concurrency
```typescript
import { Effect, pipe } from "effect"

const processElements = <A, B>(
  elements: readonly A[],
  process: (a: A) => Effect.Effect<B>
): Effect.Effect<readonly B[]> =>
  pipe(
    elements,
    Effect.forEach(process, {
      concurrency: "unbounded",
      discard: false
    }),
    Effect.map((results) => results.filter(Boolean))
  )

// With timeout
const withTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  duration: Duration
): Effect.Effect<Option.Option<A>, E | TimeoutException> =>
  pipe(
    effect,
    Effect.timeout(duration),
    Effect.map(Option.fromNullable)
  )

// Parallel with error recovery
const processParallel = <A, B>(
  items: readonly A[],
  process: (a: A) => Effect.Effect<B>
): Effect.Effect<readonly B[]> =>
  pipe(
    items,
    Effect.forEach(
      (item) =>
        pipe(
          process(item),
          Effect.either // Convert to Either<E, A>
        ),
      { concurrency: "unbounded" }
    ),
    Effect.map((results) =>
      results
        .filter(Either.isRight)
        .map((either) => either.right)
    )
  )
```

## State Management Patterns

### Python State Management
```python
from dataclasses import dataclass, field
from typing import Optional
import asyncio

@dataclass
class AgentState:
    current_url: Optional[str] = None
    history: List[Action] = field(default_factory=list)
    memory: Dict[str, Any] = field(default_factory=dict)
    
    def add_action(self, action: Action):
        self.history.append(action)
    
    def get_recent_actions(self, n: int = 5):
        return self.history[-n:]

class StatefulAgent:
    def __init__(self):
        self.state = AgentState()
        self._lock = asyncio.Lock()
    
    async def execute(self, action: Action):
        async with self._lock:
            result = await self._perform_action(action)
            self.state.add_action(action)
            return result
```

#### Effect State Management
```typescript
import { Ref, Effect, pipe } from "effect"

// State definition
interface AgentState {
  readonly currentUrl: Option.Option<string>
  readonly history: readonly Action[]
  readonly memory: ReadonlyMap<string, unknown>
}

const initialState: AgentState = {
  currentUrl: Option.none(),
  history: [],
  memory: new Map()
}

// State operations
const AgentStateOps = {
  addAction: (action: Action) => (state: AgentState): AgentState => ({
    ...state,
    history: [...state.history, action]
  }),
  
  getRecentActions: (n: number) => (state: AgentState): readonly Action[] =>
    state.history.slice(-n),
  
  updateUrl: (url: string) => (state: AgentState): AgentState => ({
    ...state,
    currentUrl: Option.some(url)
  })
}

// Stateful service
class StatefulAgent extends Context.Tag("StatefulAgent")<
  StatefulAgent,
  {
    execute: (action: Action) => Effect.Effect<Result>
    getState: Effect.Effect<AgentState>
    getRecentActions: (n?: number) => Effect.Effect<readonly Action[]>
  }
>() {}

const StatefulAgentLive = Layer.effect(
  StatefulAgent,
  Effect.gen(function* () {
    const state = yield* Ref.make(initialState)
    const browser = yield* BrowserService
    
    return {
      execute: (action) =>
        pipe(
          // Perform action
          browser.performAction(action),
          // Update state atomically
          Effect.tap(() =>
            Ref.update(state, AgentStateOps.addAction(action))
          ),
          // Use STM for complex atomic operations
          Effect.withSTM
        ),
      
      getState: Ref.get(state),
      
      getRecentActions: (n = 5) =>
        pipe(
          Ref.get(state),
          Effect.map(AgentStateOps.getRecentActions(n))
        )
    }
  })
)
```

## Resource Management Patterns

### Python Context Managers
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def browser_session(config: Config):
    browser = None
    try:
        browser = await launch_browser(config)
        session = await browser.new_session()
        yield session
    finally:
        if browser:
            await browser.close()

# Usage
async def scrape_page(url: str):
    async with browser_session(config) as session:
        await session.navigate(url)
        return await session.extract_text()
```

#### Effect Resource Management
```typescript
import { Effect, Scope, pipe } from "effect"

// Resource definition
const browserSession = (config: Config) =>
  Effect.acquireRelease(
    // Acquire
    Effect.gen(function* () {
      const browser = yield* launchBrowser(config)
      const session = yield* browser.newSession()
      return { browser, session }
    }),
    // Release
    ({ browser }) => browser.close()
  )

// Usage with scoped
const scrapePage = (url: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { session } = yield* browserSession(config)
      yield* session.navigate(url)
      return yield* session.extractText()
    })
  )

// Alternative: Resource as a Layer
const BrowserSessionLive = Layer.scoped(
  BrowserSession,
  Effect.gen(function* () {
    const config = yield* Config
    const browser = yield* launchBrowser(config)
    
    // Ensure cleanup on scope close
    yield* Effect.addFinalizer(() => browser.close())
    
    const session = yield* browser.newSession()
    
    return BrowserSession.of({
      navigate: session.navigate,
      extractText: session.extractText
    })
  })
)
```

## Testing Patterns

### Python Pytest
```python
import pytest
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_dom_service():
    mock_cdp = AsyncMock()
    mock_cdp.send.return_value = {"root": {"nodeId": 1}}
    
    service = DOMService(mock_cdp, Config())
    result = await service.get_dom_tree("session-1")
    
    assert result.node_id == 1
    mock_cdp.send.assert_called_once_with(
        "DOM.getDocument",
        {"depth": -1, "pierce": True},
        session_id="session-1"
    )

@pytest.fixture
async def browser():
    browser = await launch_browser()
    yield browser
    await browser.close()
```

#### Effect Testing
```typescript
import { Effect, Layer, TestContext } from "effect"
import { describe, it, expect } from "vitest"

describe("DOMService", () => {
  it("fetches DOM tree", () =>
    Effect.gen(function* () {
      // Create test layer with mocked dependencies
      const TestCDPClient = Layer.succeed(
        CDPClient,
        CDPClient.of({
          send: () => Effect.succeed({ root: { nodeId: 1 } })
        })
      )
      
      // Run test with test environment
      const result = yield* pipe(
        DOMService.getDOMTree("session-1"),
        Effect.provide(DOMServiceLive),
        Effect.provide(TestCDPClient),
        Effect.provide(ConfigTest)
      )
      
      expect(result.nodeId).toBe(1)
    }).pipe(Effect.runPromise)
  )
  
  // Test with resource management
  it("manages browser lifecycle", () =>
    Effect.gen(function* () {
      const result = yield* pipe(
        scrapePage("https://example.com"),
        Effect.provide(BrowserSessionLive),
        Effect.provide(ConfigTest)
      )
      
      expect(result).toBeDefined()
      // Browser is automatically closed after test
    }).pipe(Effect.runPromise)
  )
})

// Test fixtures as Layers
const BrowserTest = Layer.effect(
  BrowserService,
  Effect.gen(function* () {
    const browser = yield* launchBrowser(testConfig)
    
    yield* Effect.addFinalizer(() => browser.close())
    
    return browser
  })
)
```

## Advanced Patterns

### Retry Logic
```python
# Python with retries
async def with_retry(
    func,
    max_attempts: int = 3,
    backoff: float = 1.0
):
    for attempt in range(max_attempts):
        try:
            return await func()
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            await asyncio.sleep(backoff * (2 ** attempt))
```

```typescript
// Effect with retries
const withRetry = <A, E>(effect: Effect.Effect<A, E>) =>
  pipe(
    effect,
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.intersect(Schedule.recurs(3))
      )
    )
  )
```

### Rate Limiting
```python
# Python rate limiting
from asyncio import Semaphore

class RateLimiter:
    def __init__(self, rate: int):
        self.semaphore = Semaphore(rate)
    
    async def acquire(self):
        async with self.semaphore:
            yield
```

```typescript
// Effect rate limiting
const rateLimited = <A, E>(
  effect: Effect.Effect<A, E>,
  rate: number
) =>
  pipe(
    effect,
    Effect.withPermits(1),
    Effect.provide(
      Layer.succeed(
        Semaphore,
        Semaphore.make(rate)
      )
    )
  )
```

## Migration Checklist

### For Each Python Module:
- [ ] Convert async functions to Effect
- [ ] Replace Pydantic models with Effect Schema
- [ ] Transform class services to Effect services
- [ ] Update error handling to Effect patterns
- [ ] Migrate tests to Effect testing
- [ ] Add proper resource management
- [ ] Implement Effect layers for dependencies

### Common Gotchas:
1. **Lazy vs Eager**: Effect is lazy, Python async is eager
2. **Error Types**: Effect requires explicit error types
3. **Dependency Injection**: Use Layers instead of constructor injection
4. **State Management**: Use Ref/STM instead of class attributes
5. **Testing**: Provide test layers for all dependencies

## Quick Reference

| Python | Effect | Notes |
|--------|---------|-------|
| `async def` | `Effect.Effect<A, E>` | Effect is lazy |
| `await` | `yield*` (in gen) | Inside Effect.gen |
| `try/except` | `Effect.catchAll` | Typed errors |
| `asyncio.gather` | `Effect.all` | Parallel execution |
| `@dataclass` | `S.Struct` | Schema validation |
| `with` statement | `Effect.scoped` | Resource safety |
| `asyncio.Lock` | `Ref` / `STM` | Concurrent state |
| `EventBus` | `PubSub` / `Stream` | Event handling |

This guide provides the foundation for migrating Python patterns to Effect TypeScript, ensuring type safety, better error handling, and improved resource management.