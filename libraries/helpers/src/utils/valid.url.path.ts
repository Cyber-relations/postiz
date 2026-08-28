import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return (
      !!text?.split?.('?')?.[0].endsWith('.png') ||
      !!text?.split?.('?')?.[0].endsWith('.jpg') ||
      !!text?.split?.('?')?.[0].endsWith('.jpeg') ||
      !!text?.split?.('?')?.[0].endsWith('.gif') ||
      !!text?.split?.('?')?.[0].endsWith('.webp') ||
      !!text?.split?.('?')?.[0].endsWith('.mp4')
    );
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'File must have a valid extension: .png, .jpg, .jpeg, .gif, .webp, or .mp4'
    );
  }
}

// toybaco_media_url_boundary_v1: 保存済みmediaだけを投稿へ渡す。
export function toybacoIsAllowedUploadUrl(
  text: string,
  configuredDomains: string | undefined = process.env.RESTRICT_UPLOAD_DOMAINS
) {
  if (!configuredDomains || !text) return false;
  // アプリが生成するobject keyにpercent escapeは無い。URL constructorが
  // %2e%2eを正規化する前に拒否し、別表現を許可側へ倒さない。
  if (text.includes('%')) return false;

  let candidate: URL;
  try {
    candidate = new URL(text);
  } catch {
    return false;
  }
  if (
    candidate.protocol !== 'https:' ||
    candidate.username ||
    candidate.password ||
    candidate.port ||
    candidate.search ||
    candidate.hash ||
    !/^\/[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.(?:png|jpe?g|gif|webp|mp4)$/i.test(
      candidate.pathname
    )
  ) {
    return false;
  }

  return configuredDomains.split(',').some((entry) => {
    let allowed: URL;
    try {
      allowed = new URL(entry.trim());
    } catch {
      return false;
    }
    if (
      allowed.protocol !== 'https:' ||
      allowed.username ||
      allowed.password ||
      allowed.port ||
      allowed.pathname !== '/' ||
      allowed.search ||
      allowed.hash
    ) {
      return false;
    }
    return candidate.origin === allowed.origin;
  });
}

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return toybacoIsAllowedUploadUrl(text);
  }

  defaultMessage(args: ValidationArguments) {
    return 'アップロード済みのメディアを指定してください';
  }
}
