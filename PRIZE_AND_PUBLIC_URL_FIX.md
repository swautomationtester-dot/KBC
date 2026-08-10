# Prize ladder + public URL fix

Prize ladder is now Q1 ₹10, Q2 ₹20, Q3 ₹30, Q4 ₹40, Q5 ₹50 (₹150 total).

Generated Join/TV/Audience URLs now use the reverse-proxy host when PUBLIC_URL is
unset or incorrectly configured as localhost. If PUBLIC_URL is set to a real
production URL, that value remains authoritative.

After deployment, restart the Node.js process and hard-refresh the browser.
