import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_STORE_SETTINGS, EMPTY_ONBOARDING } from '@pricelogic/shared';
import { EncryptionService } from '../../../common/crypto/encryption.service';
import {
  InitializationStatus,
  Shop,
  ShopStatus,
} from '../entities/shop.entity';

export interface UpsertShopInput {
  shopifyShopId: string;
  shopDomain: string;
  accessToken: string;
  currency?: string;
  timezone?: string;
}

@Injectable()
export class ShopsService {
  private readonly logger = new Logger(ShopsService.name);

  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    private readonly encryptionService: EncryptionService,
  ) {}

  findById(id: string): Promise<Shop | null> {
    return this.shopRepository.findOneBy({ id });
  }

  findByShopifyShopId(shopifyShopId: string): Promise<Shop | null> {
    return this.shopRepository.findOneBy({ shopifyShopId });
  }

  findByDomain(shopDomain: string): Promise<Shop | null> {
    return this.shopRepository.findOneBy({ shopDomain });
  }

  /**
   * Called only after OAuth + HMAC verification has fully succeeded.
   * A Shopify store maps to exactly one Shop row: if one already exists for
   * this shopify_shop_id (reinstall/reconnect), it's updated in place —
   * never duplicated — and brought back to ACTIVE.
   */
  async upsertFromInstall(input: UpsertShopInput): Promise<Shop> {
    const existing = await this.findByShopifyShopId(input.shopifyShopId);
    const accessTokenEncrypted = this.encryptionService.encrypt(
      input.accessToken,
    );

    if (existing) {
      existing.shopDomain = input.shopDomain;
      existing.accessTokenEncrypted = accessTokenEncrypted;
      existing.status = ShopStatus.ACTIVE;
      if (input.currency) existing.currency = input.currency;
      if (input.timezone) existing.timezone = input.timezone;
      // Settings and onboarding are deliberately untouched. They survived the
      // uninstall, and a merchant reinstalling has not asked to be reset to
      // defaults — overwriting here would be the app discarding a decision it
      // was specifically built to remember.
      this.logger.log(`Reconnected existing shop ${existing.id}`);
      return this.shopRepository.save(existing);
    }

    const created = this.shopRepository.create({
      shopifyShopId: input.shopifyShopId,
      shopDomain: input.shopDomain,
      accessTokenEncrypted,
      currency: input.currency ?? 'USD',
      timezone: input.timezone ?? 'UTC',
      status: ShopStatus.ACTIVE,
      // Set up on arrival. Setup is optional, which only means something if the
      // shop is usable before the merchant has answered anything — a shop with
      // no settings would push every screen back into asking for them.
      initializationStatus: InitializationStatus.COMPLETE,
      defaultSettings: { ...DEFAULT_STORE_SETTINGS },
      onboarding: { ...EMPTY_ONBOARDING },
    });
    const saved = await this.shopRepository.save(created);
    this.logger.log(`Created new shop ${saved.id}`);
    return saved;
  }

  /** Decrypts on demand — callers must never forward this outside the server. */
  getDecryptedAccessToken(shop: Shop): string {
    return this.encryptionService.decrypt(shop.accessTokenEncrypted);
  }

  async disconnectByDomain(shopDomain: string): Promise<void> {
    const shop = await this.findByDomain(shopDomain);
    if (!shop) return;
    shop.status = ShopStatus.DISCONNECTED;
    await this.shopRepository.save(shop);
    this.logger.log(`Shop ${shop.id} disconnected`);
  }

  async suspend(shopId: string): Promise<void> {
    await this.shopRepository.update(
      { id: shopId },
      { status: ShopStatus.SUSPENDED },
    );
  }

  async reactivate(shopId: string): Promise<void> {
    await this.shopRepository.update(
      { id: shopId },
      { status: ShopStatus.ACTIVE },
    );
  }
}
