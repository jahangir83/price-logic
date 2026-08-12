import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { InitializationStatus, Shop, ShopStatus } from './entities/shop.entity';

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
      initializationStatus: InitializationStatus.NOT_STARTED,
      defaultSettings: {},
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
