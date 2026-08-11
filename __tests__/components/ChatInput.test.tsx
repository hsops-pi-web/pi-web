import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatInput } from "@/components/ChatInput";

afterEach(cleanup);

const modelProps = {
  onSend: () => true,
  onAbort: () => {},
  isStreaming: false,
  model: { provider: "opus-5-tsingmao", modelId: "claude-opus-5" },
  modelList: [{ id: "claude-opus-5", name: "Claude Opus 5", provider: "opus-5-tsingmao" }],
  onModelChange: () => {},
};

describe("ChatInput 模型切换错误提示", () => {
  it("传入 modelError 时应显示错误文本", () => {
    render(
      <ChatInput
        {...modelProps}
        modelError="Model not found: opus-5-tsingmao/claude-opus-5"
      />
    );

    expect(
      screen.getByText("Model not found: opus-5-tsingmao/claude-opus-5")
    ).toBeTruthy();
  });

  it("没有 modelError 时不显示提示", () => {
    render(<ChatInput {...modelProps} modelError={null} />);

    expect(screen.queryByText(/Model not found/)).toBeNull();
  });
});
