'use client';

import { FC, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactTags } from 'react-tag-autocomplete';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Input } from '@gitroom/react/form/input';
import { ColorPicker } from '@gitroom/react/form/color.picker';
import { Button } from '@gitroom/react/form/button';
import { uniqBy } from 'lodash';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useClickOutside } from '@mantine/hooks';
import { useFooterPopupFocus, useFooterPopupPosition } from '@gitroom/frontend/components/launches/helpers/date.picker';
import clsx from 'clsx';
import { useModalIsLast, useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  TagIcon,
  DropdownArrowIcon,
  PlusIcon,
  CheckmarkIcon,
} from '@gitroom/frontend/components/ui/icons';

export const TagsComponent: FC<{
  name: string;
  label: string;
  initial: any[];
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const fetch = useFetch();

  const loadTags = useCallback(async () => {
    return (await fetch('/posts/tags')).json();
  }, []);

  const { data, isLoading, mutate } = useSWR('load-tags', loadTags);

  if (isLoading) {
    return null;
  }

  return <TagsComponentInner {...props} allTags={data} mutate={mutate} />;
};

const FooterTagDialog: FC<{
  children: ReactNode;
  initialFocus: 'input' | 'button';
  onCancel: () => void;
  returnFocus: HTMLElement;
  fallbackFocus: { current: HTMLButtonElement | null };
}> = ({ children, initialFocus, onCancel, returnFocus, fallbackFocus }) => {
  const ref = useRef<HTMLDivElement>(null);
  const isLast = useModalIsLast();
  useEffect(() => {
    const content = ref.current;
    const fallback = fallbackFocus.current;
    return () => {
      const active = document.activeElement;
      const dialog = content?.closest('[data-toybaco-tag-dialog]');
      if (active && active !== document.body && !dialog?.contains(active)) return;
      const target = returnFocus.isConnected ? returnFocus : fallback;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocus, fallbackFocus]);
  useEffect(() => {
    if (!isLast) return;
    const content = ref.current;
    const dialog = content?.closest<HTMLElement>('[data-toybaco-tag-dialog]');
    if (!dialog) return;
    (content?.querySelector<HTMLElement>(initialFocus) || content)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!event.isComposing) { event.preventDefault(); onCancel(); }
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]'
      )).filter((element) => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); content?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === content)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => dialog.removeEventListener('keydown', keydown);
  }, [isLast, initialFocus, onCancel]);
  return <div ref={ref} tabIndex={-1} className="flex flex-col gap-[16px]">{children}</div>;
};

export const TagsComponentInner: FC<{
  name: string;
  label: string;
  initial: any[];
  allTags: any;
  mutate: () => Promise<any>;
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = ({ initial, onChange, name, mutate, allTags: data }) => {
  const t = useT();
  const fetch = useFetch();
  const [isOpen, setIsOpen] = useState(false);
  const [allowClose, setAllowClose] = useState(true);
  const [tagValue, setTagValue] = useState<any[]>(
    (initial?.slice(0) || []).map((p: any) => {
      return data?.tags.find((a: any) => a.name === p.value) || p;
    })
  );
  const modals = useModals();

  const ref = useClickOutside(() => {
    if (!isOpen || !allowClose) {
      return;
    }
    setIsOpen(false);
  });

  const popupStyle = useFooterPopupPosition(isOpen, ref, 240);
  const keyboard = useFooterPopupFocus(isOpen, setIsOpen);
  const addTag = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    const returnFocus = event.currentTarget;
    setAllowClose(false);
    const val: string | undefined = await new Promise((resolve) => {
      modals.openModal({
        title: t('add_new_tag', 'Add New Tag'),
        size: 'min(600px, calc(100vw - 32px))',
        toybacoTagDialog: true,
        onClose: () => resolve(undefined),
        children: (close) => (
          <FooterTagDialog initialFocus="input" onCancel={close} returnFocus={returnFocus} fallbackFocus={keyboard.triggerRef}>
            <ShowModal tag="" close={close} resolve={resolve} />
            <Button onClick={close}>{t('cancel', 'Cancel')}</Button>
          </FooterTagDialog>
        ),
      });
    });

    setAllowClose(true);
    const newValues = await mutate();

    if (!val) {
      return;
    }

    const newTag = newValues.tags.find((p: any) => p.name === val);
    if (newTag) {
      const modify = [...tagValue, newTag];
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    }
  }, [keyboard.triggerRef]);

  const deleteTag = useCallback(
    async (tag: any, e: React.MouseEvent) => {
      const returnFocus = e.currentTarget as HTMLElement;
      setAllowClose(false);
      e.stopPropagation();
      const confirmed: boolean = await new Promise((resolve) => {
        modals.openModal({
          title: t('delete_tag', 'Delete Tag'),
          size: 'min(600px, calc(100vw - 32px))',
          toybacoTagDialog: true,
          onClose: () => resolve(false),
          children: (close) => (
            <FooterTagDialog initialFocus="button" onCancel={close} returnFocus={returnFocus} fallbackFocus={keyboard.triggerRef}>
              <ConfirmDeleteModal
                tagName={tag.name}
                close={close}
                resolve={resolve}
              />
            </FooterTagDialog>
          ),
        });
      });

      if (!confirmed) {
        setTimeout(() => {
          setAllowClose(true);
        }, 500);
        return;
      }

      await fetch(`/posts/tags/${tag.id}`, {
        method: 'DELETE',
      });

      // Remove the tag from current selection if it was selected
      const modify = tagValue.filter((a) => a.id !== tag.id);
      if (modify.length !== tagValue.length) {
        setTagValue(modify);
        onChange({
          target: {
            value: modify.map((p: any) => ({
              label: p.name,
              value: p.name,
            })),
            name,
          },
        });
      }

      await mutate();

      setTimeout(() => {
        setAllowClose(true);
      }, 500);
    },
    [tagValue, name, onChange, mutate, fetch, modals, t, keyboard.triggerRef]
  );

  return (
    <div
      ref={ref}
      onKeyDown={keyboard.onKeyDown}
      onBlur={allowClose ? keyboard.onBlur : undefined}
      className={clsx(
        'border rounded-[8px] justify-center flex items-center relative h-[44px] text-[15px] font-[600] select-none',
        isOpen ? 'border-[#612BD3]' : 'border-newTextColor/10'
      )}
    >
      <button
        type="button"
        ref={keyboard.triggerRef}
        onClick={keyboard.toggle}
        onKeyDown={keyboard.onTriggerKeyDown}
        aria-expanded={isOpen}
        aria-controls={keyboard.popupId}
        className="px-[16px] justify-center flex gap-[8px] items-center h-full select-none flex-1 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B5B]"
      >
        <span className="cursor-pointer">
          <TagIcon />
        </span>
        <span className="cursor-pointer flex gap-[4px]">
          {tagValue.length === 0 ? (
            t('add_new_tag', 'Add New Tag')
          ) : (
            <>
              <span
                className="h-full flex justify-center items-center px-[8px] rounded-[4px]"
                style={{ backgroundColor: tagValue[0].color }}
              >
                <span className="text-shadow-tags text-[#fff]">
                  {tagValue[0].name}
                </span>
              </span>
              {tagValue.length > 1 ? <span>+{tagValue.length - 1}</span> : null}
            </>
          )}
        </span>
        <span className="cursor-pointer">
          <DropdownArrowIcon rotated={isOpen} />
        </span>
      </button>
      {isOpen && (
        <div data-toybaco-footer-popup="tags" id={keyboard.popupId} ref={keyboard.popupRef} style={popupStyle} className="bg-newBgColorInner p-[12px] menu-shadow flex flex-col">
          {(data?.tags || []).map((p: any) => (
            <div key={p.name} className="min-h-[40px] -mx-[12px] flex gap-[8px] items-center group">
              <button
                type="button"
                aria-pressed={!!tagValue.find((a) => a.id === p.id)}
              onClick={() => {
                const exists = !!tagValue.find((a) => a.id === p.id);
                let modify = [];
                if (exists) {
                  modify = tagValue.filter((a) => a.id !== p.id);
                } else {
                  modify = [...tagValue, p];
                }
                setTagValue(modify);
                onChange({
                  target: {
                    value: modify.map((p: any) => ({
                      label: p.name,
                      value: p.name,
                    })),
                    name,
                  },
                });
              }}
                className="min-h-[40px] py-[8px] pl-[20px] pr-[8px] flex gap-[8px] items-center flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF6B5B]"
              >
                <Check value={!!tagValue.find((a) => a.id === p.id)} />
                <span className="h-full flex items-center flex-1 break-all">
                  <span className="text-[#fff] px-[8px] rounded-[8px] text-shadow-tags" style={{ backgroundColor: p.color }}>{p.name}</span>
                </span>
              </button>
              {!tagValue.find((a) => a.id === p.id) && (
                <button
                  type="button"
                  aria-label={`${p.name}を削除`}
                  onClick={(e) => deleteTag(p, e)}
                  className="ms-auto mr-[20px] cursor-pointer text-red-500 text-[14px] font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF6B5B]"
                >×</button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addTag}
            className="cursor-pointer gap-[8px] flex w-full h-[34px] rounded-[8px] mt-[12px] px-[16px] justify-center items-center bg-[#612BD3] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF6B5B]"
          >
            <span aria-hidden="true">
              <PlusIcon />
            </span>
            <span className="text-[13px] font-[600]">
              {t('add_new_tag', 'Add New Tag')}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

const Check: FC<{ value: boolean }> = ({ value }) => {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'text-[10px] font-[500] text-center flex border border-btnSimple rounded-[6px] min-w-[20px] min-h-[20px] w-[20px] h-[20px] justify-center items-center',
        value && 'bg-[#612BD3]'
      )}
    >
      {value ? <CheckmarkIcon className="text-white" /> : ''}
    </span>
  );
};
export const TagsComponentA: FC<{
  name: string;
  label: string;
  initial: any[];
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, initial } = props;
  const fetch = useFetch();
  const [tagValue, setTagValue] = useState<any[]>(initial?.slice(0) || []);
  const [suggestions, setSuggestions] = useState<string>('');
  const [showModal, setShowModal] = useState<any>(false);
  const loadTags = useCallback(async () => {
    return (await fetch('/posts/tags')).json();
  }, []);
  const { isLoading, data, mutate } = useSWR<{
    tags: {
      name: string;
      color: string;
    }[];
  }>('tags', loadTags, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
  const onDelete = useCallback(
    (tagIndex: number) => {
      const modify = tagValue.filter((_, i) => i !== tagIndex);
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [tagValue]
  );
  const createNewTag = useCallback(
    async (newTag: any) => {
      const val = await new Promise((resolve) => {
        setShowModal({
          tag: newTag.value,
          resolve,
          close: () => setShowModal(false),
        });
      });
      setShowModal(false);
      mutate();
      return val;
    },
    [mutate]
  );
  const edit = useCallback(
    (tag: any) => async (e: any) => {
      e.stopPropagation();
      e.preventDefault();
      const val = await new Promise((resolve) => {
        setShowModal({
          tag: tag.name,
          color: tag.color,
          id: tag.id,
          resolve,
          close: () => setShowModal(false),
        });
      });
      setShowModal(false);
      mutate();
      const modify = tagValue.map((t) => {
        if (t.label === tag.name) {
          return {
            value: val,
            label: val,
          };
        }
        return t;
      });
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [tagValue, data]
  );
  const onAddition = useCallback(
    async (newTag: any) => {
      if (tagValue.length >= 3) {
        return;
      }
      const getTag = data?.tags?.find((f) => f.name === newTag.label)
        ? newTag.label
        : await createNewTag(newTag);
      const modify = [
        ...tagValue,
        {
          value: getTag,
          label: getTag,
        },
      ];
      setTagValue(modify);
      onChange({
        target: {
          value: modify,
          name,
        },
      });
    },
    [tagValue, data]
  );

  // useEffect(() => {
  //   const settings = getValues()[props.name];
  //   if (settings) {
  //     setTagValue(settings);
  //   }
  // }, []);

  const suggestionsArray = useMemo(() => {
    return uniqBy<{
      label: string;
      value: string;
    }>(
      [
        ...(data?.tags.map((p) => ({
          label: p.name,
          value: p.name,
        })) || []),
        ...tagValue,
        {
          label: suggestions,
          value: suggestions,
        },
      ].filter((f) => f.label),
      (o) => o.label
    );
  }, [suggestions, tagValue]);

  const t = useT();

  if (isLoading) {
    return null;
  }
  return (
    <>
      {showModal && <ShowModal {...showModal} />}
      <div className="flex-1 flex tags-top">
        <ReactTags
          placeholderText={t('add_a_tag', 'Add a tag')}
          suggestions={suggestionsArray}
          selected={tagValue}
          onAdd={onAddition}
          onInput={setSuggestions}
          onDelete={onDelete}
          renderTag={(tag) => {
            const findTag = data?.tags?.find((f) => f.name === tag.tag.label);
            const findIndex = tagValue.findIndex(
              (f) => f.label === tag.tag.label
            );
            return (
              <div
                className={`min-w-[50px] float-left ms-[4px] p-[3px] rounded-sm relative`}
                style={{
                  backgroundColor: findTag?.color,
                }}
              >
                <div
                  className="absolute -top-[5px] start-[10px] text-[12px] text-red-600 bg-white px-[3px] rounded-full"
                  onClick={edit(findTag)}
                >
                  {t('edit', 'Edit')}
                </div>
                <div
                  className="absolute -top-[5px] -start-[5px] text-[12px] text-red-600 bg-white px-[3px] rounded-full"
                  onClick={() => onDelete(findIndex)}
                >
                  X
                </div>
                <div className="text-white mix-blend-difference">
                  {tag.tag.label}
                </div>
              </div>
            );
          }}
        />
      </div>
    </>
  );
};
const ConfirmDeleteModal: FC<{
  tagName: string;
  close: () => void;
  resolve: (value: boolean) => void;
}> = ({ tagName, close, resolve }) => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="text-[14px]">
        {t(
          'confirm_delete_tag',
          'Are you sure you want to delete the tag "{{tagName}}"?',
          { tagName }
        )}
      </p>
      <div className="flex gap-[8px] justify-end">
        <Button
          onClick={() => {
            resolve(false);
            close();
          }}
        >
          {t('cancel', 'Cancel')}
        </Button>
        <Button
          onClick={() => {
            resolve(true);
            close();
          }}
          className="bg-red-500 hover:bg-red-600"
        >
          {t('delete', 'Delete')}
        </Button>
      </div>
    </div>
  );
};

const ShowModal: FC<{
  tag: string;
  color?: string;
  id?: string;
  close: () => void;
  resolve: (value: string) => void;
}> = (props) => {
  const t = useT();

  const { close, tag, resolve, color: theColor, id } = props;
  const fetch = useFetch();
  const [color, setColor] = useState<string>(theColor || '#942828');
  const [tagName, setTagName] = useState<string>(tag);
  const save = useCallback(async () => {
    await fetch(id ? `/posts/tags/${id}` : '/posts/tags', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: tagName,
        color,
      }),
    });
    resolve(tagName);
    close();
  }, [tagName, color, id]);
  return (
    <div>
      <Input
        name="name"
        disableForm={true}
        label={t('tag_name', 'Name')}
        value={tagName}
        onChange={(e) => setTagName(e.target.value)}
      />
      <ColorPicker
        onChange={(e) => setColor(e.target.value)}
        label={t('label_tag_color', 'Tag Color')}
        name="color"
        value={color}
        enabled={true}
        canBeCancelled={false}
      />
      <Button onClick={save} className="mt-[16px]">
        {t('save', 'Save')}
      </Button>
    </div>
  );
};
