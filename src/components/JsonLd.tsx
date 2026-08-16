import { jsonLdHtml } from '@/lib/structured-data';

/**
 * A Schema.org block, embedded as `application/ld+json`.
 *
 * The serialisation — including the `</script>` escape that keeps a database
 * string from closing this element early — lives in `jsonLdHtml`, so the
 * rule can be tested without a JSX transform.
 *
 * A Server Component, and it must stay one: this markup exists for crawlers,
 * so it has to be in the HTML the server sends rather than added on
 * hydration.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }}
    />
  );
}
