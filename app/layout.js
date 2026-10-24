import './globals.css';

export const metadata = {
  title: 'PayTrust',
  description: 'Escrow-backed payments',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
