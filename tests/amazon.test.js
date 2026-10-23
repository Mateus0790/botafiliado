import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { amazonAffiliateUrl, extractAsin, getAmazonProduct, hintsFromText } from '../services/amazon.js';
import { detectPlatform } from '../services/index.js';
import { toAffiliateLink } from '../services/affiliateLinks.js';

const saved = process.env.AMAZON_TAG;
afterEach(() => { if (saved === undefined) delete process.env.AMAZON_TAG; else process.env.AMAZON_TAG = saved; });

test('reconhece links da Amazon Brasil, inclusive os curtos', () => {
  for (const url of ['https://www.amazon.com.br/dp/B0C1234567', 'https://amzn.to/3abc', 'https://a.co/d/xyz']) assert.equal(detectPlatform(url), 'amazon');
  assert.equal(extractAsin('https://www.amazon.com.br/Fone-JBL/dp/B0C1234567/ref=sr_1_1?keywords=fone'), 'B0C1234567');
  assert.equal(extractAsin('https://www.amazon.com.br/gp/product/b0c1234567'), 'B0C1234567');
});

test('produto vira amazon.com.br/dp/ASIN com a sua tag; a tag de outro afiliado sai', () => {
  assert.equal(amazonAffiliateUrl('https://www.amazon.com.br/Fone-JBL/dp/B0C1234567/ref=sr_1_1?tag=outro-20&th=1', 'meusite-20'),
    'https://www.amazon.com.br/dp/B0C1234567?tag=meusite-20');
  assert.equal(amazonAffiliateUrl('https://www.amazon.com.br/deals?ref_=nav&tag=outro-20&discounts-widget=x', 'meusite-20'),
    'https://www.amazon.com.br/deals?discounts-widget=x&tag=meusite-20', 'página de ofertas mantém os filtros e troca a tag');
  assert.throws(() => amazonAffiliateUrl('https://www.amazon.com.br/dp/B0C1234567', ''), /tag de afiliado da Amazon/);
});

test('título e preço escritos abaixo do link; sem eles, título do link e "confira o preço"', () => {
  process.env.AMAZON_TAG = 'meusite-20';
  const url = 'https://www.amazon.com.br/Fone-Bluetooth-JBL-Tune-520BT/dp/B0C1234567';
  const hints = hintsFromText(`${url}\nFone JBL Tune 520BT\nR$ 199,90`, url);
  assert.deepEqual(hints, { title: 'Fone JBL Tune 520BT', price: 'R$ 199,90' });
  const product = getAmazonProduct(url, { hints });
  assert.equal(product.title, 'Fone JBL Tune 520BT');
  assert.equal(product.priceValue, 199.9);
  assert.equal(product.affiliateUrl, 'https://www.amazon.com.br/dp/B0C1234567?tag=meusite-20');
  const bare = getAmazonProduct(url);
  assert.equal(bare.title, 'Fone Bluetooth JBL Tune 520BT');
  assert.equal(bare.price, 'Confira o preço na Amazon');
});

test('cupom/página da Amazon vira link com a tag', async () => {
  process.env.AMAZON_TAG = 'meusite-20';
  assert.deepEqual(await toAffiliateLink('https://www.amazon.com.br/cupons?ref_=nav'), { platform: 'amazon', affiliateUrl: 'https://www.amazon.com.br/cupons?tag=meusite-20' });
});
