import { useEffect } from 'react';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  twitterTitle?: string;
  twitterDescription?: string;
}

export function SEO({
  title,
  description,
  keywords,
  canonical,
  ogTitle,
  ogDescription,
  ogType = 'website',
  twitterTitle,
  twitterDescription,
}: SEOProps) {
  useEffect(() => {
    // Update document title
    if (title) {
      document.title = title;
    }

    // Update or create meta tags
    const updateMetaTag = (name: string, content: string, attribute: 'name' | 'property' = 'name') => {
      if (!content) return;
      
      let element = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // Primary meta tags
    updateMetaTag('description', description || '');
    updateMetaTag('keywords', keywords || '');

    // Open Graph tags
    updateMetaTag('og:title', ogTitle || title || '');
    updateMetaTag('og:description', ogDescription || description || '');
    updateMetaTag('og:type', ogType, 'property');
    if (canonical) {
      updateMetaTag('og:url', canonical, 'property');
    }

    // Twitter tags
    updateMetaTag('twitter:title', twitterTitle || title || '', 'property');
    updateMetaTag('twitter:description', twitterDescription || description || '', 'property');

    // Canonical link
    if (canonical) {
      let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (!canonicalLink) {
        canonicalLink = document.createElement('link');
        canonicalLink.setAttribute('rel', 'canonical');
        document.head.appendChild(canonicalLink);
      }
      canonicalLink.setAttribute('href', canonical);
    }
  }, [title, description, keywords, canonical, ogTitle, ogDescription, ogType, twitterTitle, twitterDescription]);

  return null;
}
