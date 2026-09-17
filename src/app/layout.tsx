import "./globals.css";
export const metadata = { title: "Nora", description: "Your kitchen notebook" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
