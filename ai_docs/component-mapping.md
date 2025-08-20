# Component Mapping Reference

## Overview

This document provides a comprehensive mapping of every Python component in browser-use to its Effect TypeScript equivalent, serving as a reference for migration efforts.

## Directory Structure Mapping

### Python Structure → TypeScript Structure

```
browser_use/                    →    src/
├── __init__.py                →    ├── index.ts
├── agent/                     →    ├── workflows/
│   ├── __init__.py           →    │   └── agent/
│   ├── service.py            →    │       ├── service.ts
│   ├── views.py              →    │       ├── models.ts
│   └── prompts/              →    │       └── prompts/
├── browser/                   →    ├── services/browser/
│   ├── __init__.py           →    │   ├── index.ts
│   ├── service.py            →    │   ├── service.ts
│   ├── session.py            →    │   ├── session.ts
│   └── views.py              →    │   └── models.ts
├── dom/                       →    ├── services/dom/
│   ├── __init__.py           →    │   ├── index.ts
│   ├── service.py            →    │   ├── service.ts
│   ├── views.py              →    │   └── models.ts
│   └── history_tree_processor/ →    │   └── processors/
├── controller/                →    ├── controllers/
│   ├── __init__.py           →    │   ├── index.ts
│   ├── service.py            →    │   └── service.ts
│   └── views.py              →    │   └── models.ts
├── llm/                       →    ├── services/llm/
│   ├── __init__.py           →    │   ├── index.ts
│   ├── base_llm.py           →    │   ├── base.ts
│   └── providers/            →    │   └── providers/
└── utils/                     →    └── utils/
                               →    ├── wasm/              (NEW)
                               →    ├── layers/            (NEW)
                               →    └── schemas/           (NEW)
```

## Core Components Mapping

### 1. Agent Components

#### `agent/service.py` → `workflows/agent/service.ts`

**Python Implementation:**
```python
# browser_use/agent/service.py
class Agent:
    def __init__(
        self,
        task: str,
        llm: BaseLLM,
        browser: BrowserService,
        use_vision: bool = True,
        save_conversation_path: Optional[str] = None,
        max_failures: int = 5,
        retry_delay: float = 1.0
    ):
        self.task = task
        self.llm = llm
        self.browser = browser
        self.use_vision = use_vision
        self.max_failures = max_failures
        self.retry_delay = retry_delay
        self.n_steps = 1
        self.consecutive_failures = 0
        self.memory = AgentMemory()
        
    async def run(self, max_steps: int = 100) -> AgentResult:
        """Main agent loop"""
        while self.n_steps <= max_steps:
            try:
                # Get current state
                screenshot_b64 = await self.browser.take_screenshot()
                dom_state = await self.browser.get_dom_tree()
                
                # Make decision
                action = await self.llm.decide(
                    self.task,
                    screenshot_b64,
                    dom_state,
                    self.memory
                )
                
                # Execute action
                result = await self.browser.execute_action(action)
                
                self.memory.add_step(action, result)
                self.n_steps += 1
                
                if result.is_done:
                    return AgentResult(success=True, steps=self.n_steps)
                    
            except Exception as e:
                self.consecutive_failures += 1
                if self.consecutive_failures >= self.max_failures:
                    return AgentResult(success=False, error=str(e))
                await asyncio.sleep(self.retry_delay)
                
        return AgentResult(success=False, error="Max steps reached")
```

**Effect TypeScript Equivalent:**
```typescript
// workflows/agent/service.ts
import { Effect, Ref, Schedule, Stream, pipe } from "effect"

interface AgentConfig {
  readonly task: string
  readonly useVision: boolean
  readonly maxFailures: number
  readonly retryDelay: Duration
}

class AgentService extends Context.Tag("AgentService")<
  AgentService,
  {
    run: (maxSteps?: number) => Effect.Effect<AgentResult, AgentError>
  }
>() {}

const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const config = yield* Config.nested("agent")
    const llm = yield* LLMService
    const browser = yield* BrowserService
    
    const state = yield* Ref.make({
      nSteps: 1,
      consecutiveFailures: 0,
      memory: new AgentMemory()
    })
    
    const runStep = Effect.gen(function* () {
      const currentState = yield* Ref.get(state)
      
      // Get current browser state
      const screenshot = yield* browser.takeScreenshot()
      const domState = yield* browser.getDOMTree()
      
      // Make LLM decision
      const action = yield* llm.decide({
        task: config.task,
        screenshot,
        domState,
        memory: currentState.memory
      })
      
      // Execute action
      const result = yield* browser.executeAction(action)
      
      // Update memory and step count
      yield* Ref.update(state, s => ({
        ...s,
        nSteps: s.nSteps + 1,
        consecutiveFailures: 0,
        memory: s.memory.addStep(action, result)
      }))
      
      return { action, result }
    })
    
    const retryableStep = pipe(
      runStep,
      Effect.catchAll(error =>
        Effect.gen(function* () {
          yield* Ref.update(state, s => ({
            ...s,
            consecutiveFailures: s.consecutiveFailures + 1
          }))
          
          const currentState = yield* Ref.get(state)
          
          if (currentState.consecutiveFailures >= config.maxFailures) {
            return yield* Effect.fail(new AgentError({
              cause: error,
              type: "MaxFailuresReached"
            }))
          }
          
          return yield* Effect.fail(error)
        })
      ),
      Effect.retry(
        Schedule.exponential(config.retryDelay).pipe(
          Schedule.intersect(Schedule.recurs(config.maxFailures))
        )
      )
    )
    
    return {
      run: (maxSteps = 100) =>
        pipe(
          Stream.range(1, maxSteps),
          Stream.mapEffect(() => retryableStep),
          Stream.takeUntil(({ result }) => result.isDone),
          Stream.runCollect,
          Effect.map(steps => new AgentResult({
            success: true,
            steps: steps.length
          })),
          Effect.catchAll(error => 
            Effect.succeed(new AgentResult({
              success: false,
              error: error.message
            }))
          )
        )
    }
  })
)
```

#### `agent/views.py` → `workflows/agent/models.ts`

**Python Models:**
```python
# browser_use/agent/views.py
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

class AgentResult(BaseModel):
    success: bool
    steps: int = 0
    error: Optional[str] = None
    screenshot: Optional[str] = None
    extracted_content: Optional[Dict[str, Any]] = None
    
class AgentMemory(BaseModel):
    steps: List[AgentStep] = Field(default_factory=list)
    max_size: int = Field(default=50)
    
    def add_step(self, action: BrowserAction, result: ActionResult) -> None:
        step = AgentStep(
            action=action,
            result=result,
            timestamp=datetime.now()
        )
        self.steps.append(step)
        
        if len(self.steps) > self.max_size:
            self.steps.pop(0)
```

**Effect Schema Equivalent:**
```typescript
// workflows/agent/models.ts
import { Schema as S } from "@effect/schema"

const AgentResult = S.Struct({
  success: S.Boolean,
  steps: S.optional(S.Number, { default: () => 0 }),
  error: S.optional(S.String),
  screenshot: S.optional(S.String),
  extractedContent: S.optional(S.Record(S.String, S.Unknown))
})

const AgentStep = S.Struct({
  action: S.lazy(() => BrowserAction),
  result: S.lazy(() => ActionResult),
  timestamp: S.optional(S.Date, { default: () => new Date() })
})

const AgentMemory = S.Struct({
  steps: S.optional(S.Array(AgentStep), { default: () => [] }),
  maxSize: S.optional(S.Number, { default: () => 50 })
}).pipe(
  S.attachPropertySignature("addStep", S.Function),
  S.transform(
    S.Struct({
      steps: S.Array(AgentStep),
      maxSize: S.Number,
      addStep: S.Function
    }),
    {
      decode: (input) => ({
        ...input,
        addStep: (action: S.Schema.Type<typeof BrowserAction>, result: S.Schema.Type<typeof ActionResult>) => {
          const step = {
            action,
            result,
            timestamp: new Date()
          }
          
          const newSteps = [...input.steps, step]
          if (newSteps.length > input.maxSize) {
            newSteps.shift()
          }
          
          return { ...input, steps: newSteps }
        }
      }),
      encode: ({ addStep, ...rest }) => rest
    }
  )
)

type AgentResult = S.Schema.Type<typeof AgentResult>
type AgentMemory = S.Schema.Type<typeof AgentMemory>
```

### 2. Browser Components

#### `browser/service.py` → `services/browser/service.ts`

**Python Implementation:**
```python
# browser_use/browser/service.py
class BrowserService:
    def __init__(self, config: BrowserConfig = None):
        self.config = config or BrowserConfig()
        self.session: Optional[BrowserSession] = None
        
    async def start_session(self) -> BrowserSession:
        """Start a new browser session"""
        self.session = await self._create_session()
        return self.session
        
    async def _create_session(self) -> BrowserSession:
        # Launch browser with CDP
        browser_args = self._get_browser_args()
        
        if self.config.use_existing_browser:
            session = await self._connect_existing()
        else:
            session = await self._launch_new(browser_args)
            
        await session.setup_page()
        return session
        
    async def take_screenshot(self, element_id: str = None) -> str:
        """Take screenshot and return base64"""
        if not self.session:
            raise BrowserError("No active session")
            
        return await self.session.take_screenshot(element_id)
```

**Effect TypeScript Equivalent:**
```typescript
// services/browser/service.ts
import { Effect, Layer, Ref, pipe } from "effect"

class BrowserService extends Context.Tag("BrowserService")<
  BrowserService,
  {
    startSession: () => Effect.Effect<BrowserSession, BrowserError>
    takeScreenshot: (elementId?: string) => Effect.Effect<string, BrowserError>
  }
>() {}

const BrowserServiceLive = Layer.effect(
  BrowserService,
  Effect.gen(function* () {
    const config = yield* BrowserConfig
    const session = yield* Ref.make<Option.Option<BrowserSession>>(Option.none())
    
    const createSession = Effect.gen(function* () {
      const browserArgs = getBrowserArgs(config)
      
      const newSession = config.useExistingBrowser
        ? yield* connectExisting()
        : yield* launchNew(browserArgs)
        
      yield* newSession.setupPage()
      return newSession
    })
    
    const ensureSession = Effect.gen(function* () {
      const current = yield* Ref.get(session)
      
      if (Option.isSome(current)) {
        return current.value
      }
      
      const newSession = yield* createSession
      yield* Ref.set(session, Option.some(newSession))
      return newSession
    })
    
    return {
      startSession: () =>
        pipe(
          createSession,
          Effect.tap(s => Ref.set(session, Option.some(s))),
          Effect.withSpan("BrowserService.startSession")
        ),
        
      takeScreenshot: (elementId?) =>
        pipe(
          ensureSession,
          Effect.flatMap(s => s.takeScreenshot(elementId)),
          Effect.withSpan("BrowserService.takeScreenshot", {
            attributes: { elementId: elementId ?? "fullpage" }
          })
        )
    }
  })
)
```

### 3. DOM Components

#### `dom/service.py` → `services/dom/service.ts`

**Python Implementation:**
```python
# browser_use/dom/service.py  
class DOMService:
    def __init__(self, browser_session: BrowserSession):
        self.session = browser_session
        
    async def get_dom_tree(self, include_shadow_dom: bool = False) -> DOMNode:
        """Extract DOM tree from browser"""
        result = await self.session.cdp.send(
            "DOM.getDocument",
            {"depth": -1, "pierce": include_shadow_dom}
        )
        
        return self._parse_dom_node(result["root"])
        
    def _parse_dom_node(self, raw_node: Dict[str, Any]) -> DOMNode:
        """Convert CDP node to internal format"""
        node = DOMNode(
            node_id=raw_node["nodeId"],
            node_type=raw_node.get("nodeType", 1),
            tag_name=raw_node.get("localName"),
            attributes=dict(zip(
                raw_node.get("attributes", [])[::2],
                raw_node.get("attributes", [])[1::2]
            )),
            text_content=raw_node.get("nodeValue")
        )
        
        # Process children recursively
        for child_data in raw_node.get("children", []):
            child_node = self._parse_dom_node(child_data)
            node.children.append(child_node)
            
        return node
```

**Effect TypeScript Equivalent:**
```typescript
// services/dom/service.ts
import { Effect, pipe } from "effect"

class DOMService extends Context.Tag("DOMService")<
  DOMService,
  {
    getDOMTree: (includeShadowDOM?: boolean) => Effect.Effect<DOMNode, DOMError>
    serialize: (node: DOMNode) => Effect.Effect<string, DOMError>
  }
>() {}

const DOMServiceLive = Layer.effect(
  DOMService,
  Effect.gen(function* () {
    const browser = yield* BrowserService
    const wasm = yield* WasmModule
    
    const parseDOMNode = (rawNode: unknown): Effect.Effect<DOMNode, DOMError> =>
      pipe(
        rawNode,
        S.decode(CDPDOMNodeSchema),
        Effect.map(cdpNode => ({
          nodeId: cdpNode.nodeId,
          nodeType: cdpNode.nodeType ?? 1,
          tagName: cdpNode.localName ?? null,
          attributes: parseAttributes(cdpNode.attributes ?? []),
          textContent: cdpNode.nodeValue ?? null,
          children: []
        })),
        Effect.mapError(e => new DOMError({ cause: e, operation: "parse" }))
      )
    
    const parseChildren = (
      node: DOMNode,
      children: readonly unknown[]
    ): Effect.Effect<DOMNode, DOMError> =>
      pipe(
        children,
        Effect.forEach(parseDOMNode),
        Effect.map(childNodes => ({
          ...node,
          children: childNodes
        }))
      )
    
    return {
      getDOMTree: (includeShadowDOM = false) =>
        pipe(
          browser.getSession(),
          Effect.flatMap(session => 
            session.cdp.send("DOM.getDocument", {
              depth: -1,
              pierce: includeShadowDOM
            })
          ),
          Effect.flatMap(result => parseDOMNode(result.root)),
          Effect.withSpan("DOMService.getDOMTree")
        ),
        
      serialize: (node) =>
        pipe(
          wasm.serializeDOM(node),
          Effect.mapError(e => new DOMError({ 
            cause: e, 
            operation: "serialize" 
          })),
          Effect.withSpan("DOMService.serialize")
        )
    }
  })
)

// Utility functions
const parseAttributes = (attrs: readonly string[]): ReadonlyMap<string, string> => {
  const map = new Map<string, string>()
  for (let i = 0; i < attrs.length; i += 2) {
    map.set(attrs[i], attrs[i + 1] ?? "")
  }
  return map
}
```

### 4. LLM Components

#### `llm/base_llm.py` → `services/llm/base.ts`

**Python Implementation:**
```python
# browser_use/llm/base_llm.py
from abc import ABC, abstractmethod

class BaseLLM(ABC):
    @abstractmethod
    async def complete(self, messages: List[Dict[str, str]]) -> str:
        """Complete the conversation"""
        pass
        
    @abstractmethod
    async def decide(
        self,
        task: str,
        screenshot: str,
        dom_state: DOMNode,
        memory: AgentMemory
    ) -> BrowserAction:
        """Decide next browser action"""
        pass
```

**Effect TypeScript Equivalent:**
```typescript
// services/llm/base.ts
import { Effect } from "effect"

interface LLMMessage {
  readonly role: "system" | "user" | "assistant"
  readonly content: string
  readonly images?: readonly string[]
}

interface DecisionContext {
  readonly task: string
  readonly screenshot: string
  readonly domState: DOMNode
  readonly memory: AgentMemory
}

class LLMService extends Context.Tag("LLMService")<
  LLMService,
  {
    complete: (messages: readonly LLMMessage[]) => Effect.Effect<string, LLMError>
    decide: (context: DecisionContext) => Effect.Effect<BrowserAction, LLMError>
  }
>() {}

// Base implementation that providers can extend
const createLLMService = <Env>(
  implementation: {
    complete: (messages: readonly LLMMessage[]) => Effect.Effect<string, LLMError, Env>
    decide: (context: DecisionContext) => Effect.Effect<BrowserAction, LLMError, Env>
  }
): Layer.Layer<LLMService, never, Env> =>
  Layer.succeed(LLMService, implementation)
```

#### `llm/providers/openai.py` → `services/llm/providers/openai.ts`

**Python Implementation:**
```python
# browser_use/llm/providers/openai.py
import openai
from typing import List, Dict

class OpenAILLM(BaseLLM):
    def __init__(self, api_key: str, model: str = "gpt-4"):
        self.client = openai.AsyncOpenAI(api_key=api_key)
        self.model = model
        
    async def complete(self, messages: List[Dict[str, str]]) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.7
        )
        return response.choices[0].message.content
```

**Effect TypeScript Equivalent:**
```typescript
// services/llm/providers/openai.ts
import { Effect, Config, HttpClient, pipe } from "effect"

interface OpenAIConfig {
  readonly apiKey: string
  readonly model: string
  readonly baseURL?: string
}

const OpenAIConfigLive = Config.nested("openai").pipe(
  Config.map(config => ({
    apiKey: config.apiKey,
    model: config.model ?? "gpt-4",
    baseURL: config.baseURL ?? "https://api.openai.com/v1"
  }))
)

const OpenAILLMServiceLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* OpenAIConfigLive
    const httpClient = yield* HttpClient.HttpClient
    
    const complete = (messages: readonly LLMMessage[]) =>
      pipe(
        HttpClient.request.post("/chat/completions"),
        HttpClient.request.prependUrl(config.baseURL),
        HttpClient.request.bearerToken(config.apiKey),
        HttpClient.request.jsonBody({
          model: config.model,
          messages,
          temperature: 0.7
        }),
        httpClient.execute,
        Effect.flatMap(HttpClient.response.json),
        Effect.map(response => response.choices[0].message.content),
        Effect.mapError(error => new LLMError({
          cause: error,
          provider: "openai"
        })),
        Effect.withSpan("OpenAI.complete")
      )
    
    const decide = (context: DecisionContext) =>
      pipe(
        // Build decision prompt
        buildDecisionPrompt(context),
        // Get LLM response
        complete,
        // Parse action from response
        Effect.flatMap(parseActionFromResponse),
        Effect.withSpan("OpenAI.decide")
      )
    
    return { complete, decide }
  })
)
```

### 5. Controller Components

#### `controller/service.py` → `controllers/service.ts`

**Python Implementation:**
```python
# browser_use/controller/service.py
class ControllerService:
    def __init__(
        self,
        browser: BrowserService,
        dom: DOMService,
        event_bus: EventBus
    ):
        self.browser = browser
        self.dom = dom
        self.event_bus = event_bus
        
    async def execute_action(self, action: BrowserAction) -> ActionResult:
        """Execute a browser action and return result"""
        try:
            # Emit action started event
            await self.event_bus.publish("action_started", action)
            
            # Execute based on action type
            if action.action_type == "click":
                result = await self._handle_click(action)
            elif action.action_type == "type":
                result = await self._handle_type(action)
            elif action.action_type == "scroll":
                result = await self._handle_scroll(action)
            else:
                raise ValueError(f"Unknown action type: {action.action_type}")
                
            # Emit action completed event
            await self.event_bus.publish("action_completed", result)
            return result
            
        except Exception as e:
            error_result = ActionResult(
                success=False,
                error=str(e),
                action=action
            )
            await self.event_bus.publish("action_failed", error_result)
            return error_result
```

**Effect TypeScript Equivalent:**
```typescript
// controllers/service.ts
import { Effect, Match, pipe } from "effect"

class ControllerService extends Context.Tag("ControllerService")<
  ControllerService,
  {
    executeAction: (action: BrowserAction) => Effect.Effect<ActionResult, ControllerError>
  }
>() {}

const ControllerServiceLive = Layer.effect(
  ControllerService,
  Effect.gen(function* () {
    const browser = yield* BrowserService
    const dom = yield* DOMService
    const eventBus = yield* EventBus
    
    const handleClick = (action: ClickAction): Effect.Effect<ActionResult, ControllerError> =>
      pipe(
        browser.click(action.target),
        Effect.map(clickResult => new ActionResult({
          success: true,
          action,
          data: clickResult
        })),
        Effect.withSpan("Controller.handleClick")
      )
    
    const handleType = (action: TypeAction): Effect.Effect<ActionResult, ControllerError> =>
      pipe(
        browser.type(action.target, action.value),
        Effect.map(typeResult => new ActionResult({
          success: true,
          action,
          data: typeResult
        })),
        Effect.withSpan("Controller.handleType")
      )
    
    const handleScroll = (action: ScrollAction): Effect.Effect<ActionResult, ControllerError> =>
      pipe(
        browser.scroll(action.direction, action.amount),
        Effect.map(scrollResult => new ActionResult({
          success: true,
          action,
          data: scrollResult
        })),
        Effect.withSpan("Controller.handleScroll")
      )
    
    const executeActionInternal = (action: BrowserAction): Effect.Effect<ActionResult, ControllerError> =>
      pipe(
        Match.value(action),
        Match.when({ _tag: "Click" }, handleClick),
        Match.when({ _tag: "Type" }, handleType),
        Match.when({ _tag: "Scroll" }, handleScroll),
        Match.exhaustive,
        Effect.mapError(error => new ControllerError({
          cause: error,
          action
        }))
      )
    
    return {
      executeAction: (action) =>
        pipe(
          // Emit action started event
          eventBus.publish({
            _tag: "ActionStarted",
            action,
            timestamp: new Date()
          }),
          // Execute the action
          Effect.flatMap(() => executeActionInternal(action)),
          // Emit success event
          Effect.tap(result =>
            eventBus.publish({
              _tag: "ActionCompleted",
              result,
              timestamp: new Date()
            })
          ),
          // Handle errors and emit failure event
          Effect.catchAll(error =>
            pipe(
              eventBus.publish({
                _tag: "ActionFailed",
                error,
                timestamp: new Date()
              }),
              Effect.flatMap(() => Effect.fail(error))
            )
          ),
          Effect.withSpan("Controller.executeAction")
        )
    }
  })
)
```

## Layer Composition

### Main Application Layer
```typescript
// layers/index.ts
import { Layer } from "effect"

// Individual service layers
export const ServicesLive = Layer.mergeAll(
  BrowserServiceLive,
  DOMServiceLive,
  LLMServiceLive,
  ControllerServiceLive
)

// WASM modules layer
export const WasmLive = Layer.mergeAll(
  DOMSerializerWasmLive,
  TreeTraversalWasmLive,
  GeometryWasmLive
)

// Event system layer
export const EventsLive = Layer.mergeAll(
  EventBusLive,
  StreamProcessorsLive
)

// Complete application layer
export const AppLive = Layer.mergeAll(
  ConfigLive,
  ServicesLive,
  WasmLive,
  EventsLive,
  AgentServiceLive
)

// Test layers
export const TestLive = Layer.mergeAll(
  ConfigTestLive,
  MockBrowserLive,
  MockLLMLive,
  TestEventBusLive
)
```

### Configuration Mapping

#### Python Config → Effect Config
```python
# browser_use/config.py
@dataclass
class BrowserConfig:
    headless: bool = False
    viewport_width: int = 1920
    viewport_height: int = 1080
    user_data_dir: Optional[str] = None
    browser_type: str = "chromium"
```

```typescript
// config/index.ts
const BrowserConfig = Config.all({
  headless: Config.boolean("BROWSER_HEADLESS").pipe(
    Config.withDefault(false)
  ),
  viewportWidth: Config.integer("BROWSER_VIEWPORT_WIDTH").pipe(
    Config.withDefault(1920)
  ),
  viewportHeight: Config.integer("BROWSER_VIEWPORT_HEIGHT").pipe(
    Config.withDefault(1080)
  ),
  userDataDir: Config.string("BROWSER_USER_DATA_DIR").pipe(
    Config.optional
  ),
  browserType: Config.literal("chromium", "firefox")("BROWSER_TYPE").pipe(
    Config.withDefault("chromium" as const)
  )
})
```

## Migration Checklist

For each component migration, ensure:

- [ ] **Interface Compatibility**: Public APIs maintain compatibility
- [ ] **Error Handling**: All error cases properly typed and handled
- [ ] **Resource Management**: Proper cleanup with Effect scopes
- [ ] **Observability**: Spans and logging for all operations
- [ ] **Testing**: Test layers for all dependencies
- [ ] **Configuration**: Environment-based configuration
- [ ] **Performance**: WASM optimization where applicable

## Common Migration Patterns

### 1. Service Pattern
```python
# Python class-based service
class MyService:
    def __init__(self, dep: Dependency):
        self.dep = dep
    
    async def method(self, param: str) -> Result:
        return await self.dep.call(param)
```

```typescript
// Effect service
class MyService extends Context.Tag("MyService")<
  MyService,
  {
    method: (param: string) => Effect.Effect<Result, MyError>
  }
>() {}

const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dep = yield* Dependency
    
    return {
      method: (param) => dep.call(param)
    }
  })
)
```

### 2. Error Mapping
```python
# Python exception handling
try:
    result = await risky_operation()
except SpecificError as e:
    logger.error(f"Specific error: {e}")
    raise
except Exception as e:
    logger.error(f"General error: {e}")
    raise
```

```typescript
// Effect error handling
const safeOperation = pipe(
  riskyOperation(),
  Effect.catchTag("SpecificError", error =>
    pipe(
      Effect.log(`Specific error: ${error.message}`),
      Effect.flatMap(() => Effect.fail(error))
    )
  ),
  Effect.catchAllCause(cause =>
    pipe(
      Effect.log(`General error: ${cause}`),
      Effect.failCause(cause)
    )
  )
)
```

This component mapping provides a complete reference for migrating each Python component to its Effect TypeScript equivalent, ensuring consistency and best practices across the codebase.