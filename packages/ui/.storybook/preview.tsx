import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/styles/index.css";

const withTheme: Decorator = (Story, context) => {
  const root = document.documentElement;
  root.setAttribute("data-theme", context.globals.theme as string);
  root.setAttribute("data-readable", String(context.globals.readable === "on"));
  return (
    <div style={{ padding: 24 }}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: ["cream", "night", "contrast"],
        dynamicTitle: true,
      },
    },
    readable: {
      description: "Readable mode (swap pixel fonts for the reading font)",
      toolbar: { title: "Readable", icon: "eye", items: ["off", "on"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "cream", readable: "off" },
  decorators: [withTheme],
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};

export default preview;
