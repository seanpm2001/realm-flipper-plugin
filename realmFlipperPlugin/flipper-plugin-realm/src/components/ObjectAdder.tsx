import { useState } from "react";
import { SchemaPropertyValue, SchemaResponseObject } from "..";
import { Modal, Radio, InputNumber, Input, Layout, Tag, Button, RadioChangeEvent } from "antd";
import { CopyOutlined } from '@ant-design/icons';

import React from "react";
import { getDefault, TypeInput } from "./types/CommonInput";

const forEachProp = (props: {
    [key: string]: SchemaPropertyValue;
}, f: (prop: SchemaPropertyValue) => any) => {
    return Object.keys(props).map(property => { return f(props[property]) })
}

let values: {
    [prop: string]: any;
} = {};


export default (props: {schema: SchemaResponseObject | undefined, addObject: Function}) => {
    const schema = props.schema;
    if (!schema) {
        return <></>;
    }
    const [visible, setVisible] = useState(false);
    const [inputReset, setInputReset] = useState(0);
    let toClear = [];

    const showModal = () => {
        values = {};
        setVisible(true);
    };

    const hideModal = () => {
        // toClear = toClear.forEach()
        values = {};
        setInputReset(inputReset + 1);
        setVisible(false);
    };

    // const [obj, setObject] = useState(emptySt);


    const addObject = () => {
        console.log('addObject', values)
        console.log(props.addObject)
        props.addObject(values)

        hideModal();
    }

    const renderProperty = (property: SchemaPropertyValue, isPrimary: boolean) => {
        values[property.name] = getDefault(property)

        let name; 
        switch (property.type) {
            case 'list':
                name = property.objectType + '[]';
                break;
            case 'set':
                name = property.objectType + '<>';
                break;
            default:
                name = property.type;
                break;
        }
        
        const setter = (val: any) => {
            values[property.name] = val;
        }

        const value = getDefault(property)

        return (
            <Layout>
                <Layout.Header style={{ paddingLeft: 0, paddingRight: 0}}>
                    {name}
                    <span style={{ float: 'right'}}>
                    <Tag color='default'>{property.type}</Tag>
                    {!property.optional ? <Tag color='blue'>required</Tag> : null}
                    {isPrimary ? <Tag color='blue'>primary key</Tag> : null}
                    </span>
                </Layout.Header>
                <Layout.Content>
                <TypeInput property={property} setter={setter} value={value} inputReset={inputReset} />
                </Layout.Content>
            </Layout>
        )
    }
    console.log('here')

    return (
        <Layout.Content>
        <Radio.Button type="primary" onClick={showModal} style={{ float: 'right' }}>
            Create {schema.name}
        </Radio.Button>
        <Modal
            title={'Create '+schema.name}
            visible={visible}
            onOk={() => addObject()}
            onCancel={hideModal}
            okText="Create"
            cancelText="Cancel"
        >
            {forEachProp(schema.properties, property => <div key={property.name}>{renderProperty(property, property.name === schema.primaryKey)}</div>)}
        </Modal>
        </Layout.Content>
    );
}