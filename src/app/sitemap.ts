import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://signl.to',
      lastModified: new Date(),
      priority: 1,
    },
    {
      url: 'https://signl.to/privacy',
      lastModified: new Date(),
      priority: 0.3,
    },
    {
      url: 'https://signl.to/terms',
      lastModified: new Date(),
      priority: 0.3,
    },
  ];
}
