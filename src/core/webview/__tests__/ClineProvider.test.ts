// npx jest src/core/webview/__tests__/ClineProvider.test.ts

import * as vscode from "vscode"
import axios from "axios"

import { ClineProvider } from "../ClineProvider"
import { ExtensionMessage, ExtensionState } from "../../../shared/ExtensionMessage"
import { setSoundEnabled } from "../../../utils/sound"
import { setTtsEnabled } from "../../../utils/tts"
import { defaultModeSlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { ContextProxy } from "../../config/ContextProxy"

// Mock setup must come before imports
jest.mock("../../prompts/sections/custom-instructions")

// Mock dependencies
jest.mock("vscode")
jest.mock("delay")

// Mock BrowserSession
jest.mock("../../../services/browser/BrowserSession", () => ({
	BrowserSession: jest.fn().mockImplementation(() => ({
		testConnection: jest.fn().mockImplementation(async (url) => {
			if (url === "http://localhost:9222") {
				return {
					success: true,
					message: "Successfully connected to Chrome",
					endpoint: "ws://localhost:9222/devtools/browser/123",
				}
			} else {
				return {
					success: false,
					message: "Failed to connect to Chrome",
					endpoint: undefined,
				}
			}
		}),
	})),
}))

// Mock browserDiscovery
jest.mock("../../../services/browser/browserDiscovery", () => ({
	discoverChromeHostUrl: jest.fn().mockImplementation(async () => {
		return "http://localhost:9222"
	}),
	tryChromeHostUrl: jest.fn().mockImplementation(async (url) => {
		return url === "http://localhost:9222"
	}),
}))

jest.mock(
	"@modelcontextprotocol/sdk/types.js",
	() => ({
		CallToolResultSchema: {},
		ListResourcesResultSchema: {},
		ListResourceTemplatesResultSchema: {},
		ListToolsResultSchema: {},
		ReadResourceResultSchema: {},
		ErrorCode: {
			InvalidRequest: "InvalidRequest",
			MethodNotFound: "MethodNotFound",
			InternalError: "InternalError",
		},
		McpError: class McpError extends Error {
			code: string
			constructor(code: string, message: string) {
				super(message)
				this.code = code
				this.name = "McpError"
			}
		},
	}),
	{ virtual: true },
)

// Initialize mocks
const mockAddCustomInstructions = jest.fn().mockResolvedValue("Combined instructions")

;(jest.requireMock("../../prompts/sections/custom-instructions") as any).addCustomInstructions =
	mockAddCustomInstructions

// Mock delay module
jest.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return delayFn
})

// MCP-related modules are mocked once above (lines 87-109)

jest.mock(
	"@modelcontextprotocol/sdk/client/index.js",
	() => ({
		Client: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
			listTools: jest.fn().mockResolvedValue({ tools: [] }),
			callTool: jest.fn().mockResolvedValue({ content: [] }),
		})),
	}),
	{ virtual: true },
)

jest.mock(
	"@modelcontextprotocol/sdk/client/stdio.js",
	() => ({
		StdioClientTransport: jest.fn().mockImplementation(() => ({
			connect: jest.fn().mockResolvedValue(undefined),
			close: jest.fn().mockResolvedValue(undefined),
		})),
	}),
	{ virtual: true },
)

// Mock dependencies
jest.mock("vscode", () => ({
	ExtensionContext: jest.fn(),
	OutputChannel: jest.fn(),
	WebviewView: jest.fn(),
	Uri: {
		joinPath: jest.fn(),
		file: jest.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	window: {
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
	},
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue([]),
			update: jest.fn(),
		}),
		onDidChangeConfiguration: jest.fn().mockImplementation(() => ({
			dispose: jest.fn(),
		})),
		onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
}))

// Mock sound utility
jest.mock("../../../utils/sound", () => ({
	setSoundEnabled: jest.fn(),
}))

// Mock tts utility
jest.mock("../../../utils/tts", () => ({
	setTtsEnabled: jest.fn(),
	setTtsSpeed: jest.fn(),
}))

// Mock ESM modules
jest.mock("p-wait-for", () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue(undefined),
}))

// Mock fs/promises
jest.mock("fs/promises", () => ({
	mkdir: jest.fn(),
	writeFile: jest.fn(),
	readFile: jest.fn(),
	unlink: jest.fn(),
	rmdir: jest.fn(),
}))

// Mock axios
jest.mock("axios", () => ({
	get: jest.fn().mockResolvedValue({ data: { data: [] } }),
	post: jest.fn(),
}))

// Mock buildApiHandler
jest.mock("../../../api", () => ({
	buildApiHandler: jest.fn(),
}))

// Mock system prompt
jest.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: jest.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

// Mock WorkspaceTracker
jest.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return jest.fn().mockImplementation(() => ({
		initializeFilePaths: jest.fn(),
		dispose: jest.fn(),
	}))
})

// Mock Cline
jest.mock("../../Cline", () => ({
	Cline: jest
		.fn()
		.mockImplementation(
			(_provider, _apiConfiguration, _customInstructions, _diffEnabled, _fuzzyMatchThreshold, _task, taskId) => ({
				api: undefined,
				abortTask: jest.fn(),
				handleWebviewAskResponse: jest.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				overwriteClineMessages: jest.fn(),
				overwriteApiConversationHistory: jest.fn(),
				getTaskNumber: jest.fn().mockReturnValue(0),
				setTaskNumber: jest.fn(),
				setParentTask: jest.fn(),
				setRootTask: jest.fn(),
				taskId: taskId || "test-task-id",
			}),
		),
}))

// Mock extract-text
jest.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: jest.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

// Spy on console.error and console.log to suppress expected messages
beforeAll(() => {
	jest.spyOn(console, "error").mockImplementation(() => {})
	jest.spyOn(console, "log").mockImplementation(() => {})
})

afterAll(() => {
	jest.restoreAllMocks()
})

describe("ClineProvider", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock
	let updateGlobalStateSpy: jest.SpyInstance<ClineProvider["contextProxy"]["updateGlobalState"]>

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Mock context
		const globalState: Record<string, string | undefined> = {
			mode: "architect",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn().mockImplementation((key: string) => globalState[key]),
				update: jest
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: jest.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: jest.fn().mockImplementation((key: string) => secrets[key]),
				store: jest.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: jest.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: jest.fn().mockResolvedValue(undefined),
			getCustomModes: jest.fn().mockResolvedValue([]),
			dispose: jest.fn(),
		}

		// Mock output channel
		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock webview
		mockPostMessage = jest.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn().mockImplementation((callback) => {
				callback()
				return { dispose: jest.fn() }
			}),
			onDidChangeVisibility: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// @ts-ignore - Access private property for testing
		updateGlobalStateSpy = jest.spyOn(provider.contextProxy, "setValue")

		// @ts-ignore - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager
	})

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-ignore - accessing private property for testing
		provider.view = mockWebviewView
		expect(ClineProvider.getVisibleInstance()).toBe(provider)
	})

	test("resolveWebviewView sets up webview correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")
	})

	test("resolveWebviewView sets up webview correctly in development mode even if local server is not running", async () => {
		provider = new ClineProvider(
			{ ...mockContext, extensionMode: vscode.ExtensionMode.Development },
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockContext),
		)
		;(axios.get as jest.Mock).mockRejectedValueOnce(new Error("Network error"))

		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")

		// Verify Content Security Policy contains the necessary PostHog domains
		expect(mockWebviewView.webview.html).toContain(
			"connect-src https://openrouter.ai https://api.requesty.ai https://us.i.posthog.com https://us-assets.i.posthog.com;",
		)

		// Extract the script-src directive section and verify required security elements
		const html = mockWebviewView.webview.html
		const scriptSrcMatch = html.match(/script-src[^;]*;/)
		expect(scriptSrcMatch).not.toBeNull()
		expect(scriptSrcMatch![0]).toContain("'nonce-")
		// Verify wasm-unsafe-eval is present for Shiki syntax highlighting
		expect(scriptSrcMatch![0]).toContain("'wasm-unsafe-eval'")
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const mockState: ExtensionState = {
			version: "1.0.0",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
			customInstructions: undefined,
			alwaysAllowReadOnly: false,
			alwaysAllowReadOnlyOutsideWorkspace: false,
			alwaysAllowWrite: false,
			alwaysAllowWriteOutsideWorkspace: false,
			alwaysAllowExecute: false,
			alwaysAllowBrowser: false,
			alwaysAllowMcp: false,
			uriScheme: "vscode",
			soundEnabled: false,
			ttsEnabled: false,
			diffEnabled: false,
			enableCheckpoints: false,
			writeDelayMs: 1000,
			browserViewportSize: "900x600",
			fuzzyMatchThreshold: 1.0,
			mcpEnabled: true,
			enableMcpServerCreation: false,
			requestDelaySeconds: 5,
			mode: defaultModeSlug,
			customModes: [],
			experiments: experimentDefault,
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			browserToolEnabled: true,
			telemetrySetting: "unset",
			showRooIgnoredFiles: true,
			renderContext: "sidebar",
			maxReadFileLine: 500,
		}

		const message: ExtensionMessage = {
			type: "state",
			state: mockState,
		}
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("handles webviewDidLaunch message", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate webviewDidLaunch message
		await messageHandler({ type: "webviewDidLaunch" })

		// Should post state and theme to webview
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("clearTask aborts current task", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const { Cline } = require("../../Cline") // Get the mocked class
		const mockCline = new Cline() // Create a new mocked instance

		// add the mock object to the stack
		await provider.addClineToStack(mockCline)

		// get the stack size before the abort call
		const stackSizeBeforeAbort = provider.getClineStackSize()

		// call the removeClineFromStack method so it will call the current cline abort and remove it from the stack
		await provider.removeClineFromStack()

		// get the stack size after the abort call
		const stackSizeAfterAbort = provider.getClineStackSize()

		// check if the abort method was called
		expect(mockCline.abortTask).toHaveBeenCalled()

		// check if the stack size was decreased
		expect(stackSizeBeforeAbort - stackSizeAfterAbort).toBe(1)
	})

	test("addClineToStack adds multiple Cline instances to the stack", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const { Cline } = require("../../Cline") // Get the mocked class
		const mockCline1 = new Cline() // Create a new mocked instance
		const mockCline2 = new Cline() // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// add Cline instances to the stack
		await provider.addClineToStack(mockCline1)
		await provider.addClineToStack(mockCline2)

		// verify cline instances were added to the stack
		expect(provider.getClineStackSize()).toBe(2)

		// verify current cline instance is the last one added
		expect(provider.getCurrentCline()).toBe(mockCline2)
	})

	test("getState returns correct initial state", async () => {
		const state = await provider.getState()

		expect(state).toHaveProperty("apiConfiguration")
		expect(state.apiConfiguration).toHaveProperty("apiProvider")
		expect(state).toHaveProperty("customInstructions")
		expect(state).toHaveProperty("alwaysAllowReadOnly")
		expect(state).toHaveProperty("alwaysAllowWrite")
		expect(state).toHaveProperty("alwaysAllowExecute")
		expect(state).toHaveProperty("alwaysAllowBrowser")
		expect(state).toHaveProperty("taskHistory")
		expect(state).toHaveProperty("soundEnabled")
		expect(state).toHaveProperty("ttsEnabled")
		expect(state).toHaveProperty("diffEnabled")
		expect(state).toHaveProperty("writeDelayMs")
	})

	test("language is set to VSCode language", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "pt-BR"

		const state = await provider.getState()
		expect(state.language).toBe("pt-BR")
	})

	test("diffEnabled defaults to true when not set", async () => {
		// Mock globalState.get to return undefined for diffEnabled
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()

		expect(state.diffEnabled).toBe(true)
	})

	test("writeDelayMs defaults to 1000ms", async () => {
		// Mock globalState.get to return undefined for writeDelayMs
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) =>
			key === "writeDelayMs" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.writeDelayMs).toBe(1000)
	})

	test("handles writeDelayMs message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "writeDelayMs", value: 2000 })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("updates sound utility when sound setting changes", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Simulate setting sound to enabled
		await messageHandler({ type: "soundEnabled", bool: true })
		expect(setSoundEnabled).toHaveBeenCalledWith(true)
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting sound to disabled
		await messageHandler({ type: "soundEnabled", bool: false })
		expect(setSoundEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to enabled
		await messageHandler({ type: "ttsEnabled", bool: true })
		expect(setTtsEnabled).toHaveBeenCalledWith(true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to disabled
		await messageHandler({ type: "ttsEnabled", bool: false })
		expect(setTtsEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("requestDelaySeconds defaults to 10 seconds", async () => {
		// Mock globalState.get to return undefined for requestDelaySeconds
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "requestDelaySeconds") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.requestDelaySeconds).toBe(10)
	})

	test("alwaysApproveResubmit defaults to false", async () => {
		// Mock globalState.get to return undefined for alwaysApproveResubmit
		;(mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)

		const state = await provider.getState()
		expect(state.alwaysApproveResubmit).toBe(false)
	})

	test("loads saved API config when switching modes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: jest.fn().mockResolvedValue("test-id"),
			listConfig: jest.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			loadConfig: jest.fn().mockResolvedValue({ apiProvider: "anthropic" }),
			setModeConfig: jest.fn(),
		} as any

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should load the saved config for architect mode
		expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
		expect(provider.providerSettingsManager.loadConfig).toHaveBeenCalledWith("test-config")
		expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
	})

	test("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
			listConfig: jest
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
		} as any

		provider.setValue("currentApiConfigName", "current-config")

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	test("saves config as default for current mode when loading config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			loadConfig: jest.fn().mockResolvedValue({ apiProvider: "anthropic", id: "new-id" }),
			loadConfigById: jest
				.fn()
				.mockResolvedValue({ config: { apiProvider: "anthropic", id: "new-id" }, name: "new-config" }),
			listConfig: jest.fn().mockResolvedValue([{ name: "new-config", id: "new-id", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config
		await messageHandler({ type: "loadApiConfiguration", text: "new-config" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	test("load API configuration by ID works and updates mode config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			loadConfigById: jest.fn().mockResolvedValue({
				config: { apiProvider: "anthropic", id: "config-id-123" },
				name: "config-by-id",
			}),
			listConfig: jest
				.fn()
				.mockResolvedValue([{ name: "config-by-id", id: "config-id-123", apiProvider: "anthropic" }]),
			setModeConfig: jest.fn(),
			getModeConfigId: jest.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config by ID
		await messageHandler({ type: "loadApiConfigurationById", text: "config-id-123" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "config-id-123")

		// Ensure the loadConfigById method was called with the correct ID
		expect(provider.providerSettingsManager.loadConfigById).toHaveBeenCalledWith("config-id-123")
	})

	test("handles browserToolEnabled setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test browserToolEnabled
		await messageHandler({ type: "browserToolEnabled", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("browserToolEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Verify state includes browserToolEnabled
		const state = await provider.getState()
		expect(state).toHaveProperty("browserToolEnabled")
		expect(state.browserToolEnabled).toBe(true) // Default value should be true
	})

	test("handles showRooIgnoredFiles setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Default value should be true
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with true
		await messageHandler({ type: "showRooIgnoredFiles", bool: true })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", true)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with false
		await messageHandler({ type: "showRooIgnoredFiles", bool: false })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", false)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)
	})

	test("handles request delay settings messages", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Test alwaysApproveResubmit
		await messageHandler({ type: "alwaysApproveResubmit", bool: true })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("alwaysApproveResubmit", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Test requestDelaySeconds
		await messageHandler({ type: "requestDelaySeconds", value: 10 })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("requestDelaySeconds", 10)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "existing code role",
				customInstructions: "existing code prompt",
			},
			architect: {
				roleDefinition: "existing architect role",
				customInstructions: "existing architect prompt",
			},
		}

		provider.setValue("customModePrompts", existingPrompts)

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	test("customModePrompts defaults to empty object", async () => {
		// Mock globalState.get to return undefined for customModePrompts
		;(mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.customModePrompts).toEqual({})
	})

	test("handles maxWorkspaceFiles message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		await messageHandler({ type: "maxWorkspaceFiles", value: 300 })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("correctly handles user setting", async () => {
		// Mock the user setting
		jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: jest.fn().mockImplementation((key) => {
				if (key === "user") return "test-user"
				return null
			}),
		} as any)

		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		const testApiConfig = {
			apiProvider: "anthropic" as const,
			apiKey: "test-key",
			user: "test-user",
		}

		// Trigger upsertApiConfiguration
		await messageHandler({
			type: "upsertApiConfiguration",
			text: "test-config",
			apiConfiguration: testApiConfig,
		})

		// Verify config was saved with user property
		expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith(
			"test-config",
			expect.objectContaining({
				user: "test-user",
			}),
		)
	})
})

describe("Project MCP Settings", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: {
				get: jest.fn(),
				store: jest.fn(),
				delete: jest.fn(),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = jest.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: jest.fn(),
				asWebviewUri: jest.fn(),
			},
			visible: true,
			onDidDispose: jest.fn(),
			onDidChangeVisibility: jest.fn(),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test("handles openProjectMcpSettings message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions
		const fs = require("fs/promises")
		fs.mkdir.mockResolvedValue(undefined)
		fs.writeFile.mockResolvedValue(undefined)

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify directory was created
		expect(fs.mkdir).toHaveBeenCalledWith(
			expect.stringContaining(".roo"),
			expect.objectContaining({ recursive: true }),
		)

		// Verify file was created with default content
		expect(fs.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("mcp.json"),
			JSON.stringify({ mcpServers: {} }, null, 2),
		)
	})

	test("handles openProjectMcpSettings when workspace is not open", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock no workspace folders
		;(vscode.workspace as any).workspaceFolders = []

		// Trigger openProjectMcpSettings
		await messageHandler({ type: "openProjectMcpSettings" })

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.no_workspace")
	})

	test.skip("handles openProjectMcpSettings file creation error", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions to fail
		const fs = require("fs/promises")
		fs.mkdir.mockRejectedValue(new Error("Failed to create directory"))

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Failed to create or open .roo/mcp.json"),
		)
	})
})

describe.skip("ContextProxy integration", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		mockContextProxy = new ContextProxy(mockContext)
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy)
	})

	test("updateGlobalState uses contextProxy", async () => {
		await provider.setValue("currentApiConfigName", "testValue")
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("currentApiConfigName", "testValue")
	})

	test("getGlobalState uses contextProxy", async () => {
		mockContextProxy.getGlobalState.mockResolvedValueOnce("testValue")
		const result = await provider.getValue("currentApiConfigName")
		expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("currentApiConfigName")
		expect(result).toBe("testValue")
	})

	test("storeSecret uses contextProxy", async () => {
		await provider.setValue("apiKey", "test-secret")
		expect(mockContextProxy.storeSecret).toHaveBeenCalledWith("apiKey", "test-secret")
	})

	test("contextProxy methods are available", () => {
		// Verify the contextProxy has all the required methods
		expect(mockContextProxy.getGlobalState).toBeDefined()
		expect(mockContextProxy.updateGlobalState).toBeDefined()
		expect(mockContextProxy.storeSecret).toBeDefined()
		expect(mockContextProxy.setValue).toBeDefined()
		expect(mockContextProxy.setValues).toBeDefined()
	})
})

describe("getTelemetryProperties", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockCline: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: jest.fn().mockImplementation((key: string) => {
					if (key === "mode") return "code"
					if (key === "apiProvider") return "anthropic"
					return undefined
				}),
				update: jest.fn(),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: jest.fn() } as unknown as vscode.OutputChannel
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Setup Cline instance with mocked getModel method
		const { Cline } = require("../../Cline")
		mockCline = new Cline()
		mockCline.api = {
			getModel: jest.fn().mockReturnValue({
				id: "claude-3-7-sonnet-20250219",
				info: { contextWindow: 200000 },
			}),
		}
	})

	test("includes basic properties in telemetry", async () => {
		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("vscodeVersion")
		expect(properties).toHaveProperty("platform")
		expect(properties).toHaveProperty("appVersion", "1.0.0")
	})

	test("includes model ID from current Cline instance if available", async () => {
		// Add mock Cline to stack
		await provider.addClineToStack(mockCline)

		const properties = await provider.getTelemetryProperties()

		expect(properties).toHaveProperty("modelId", "claude-3-7-sonnet-20250219")
	})
})
